import os
import re
import uuid

import folder_paths
from PIL import Image

from . import media

CARD_W, CARD_H = 490, 684
MODE_PREVIEW, MODE_SAVE = "Preview", "Save"
IMAGE_KEY = re.compile(r"^image_(\d+)$")
BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class ImageInputs(dict):
    def __contains__(self, key):
        return super().__contains__(key) or bool(IMAGE_KEY.match(str(key)))

    def __getitem__(self, key):
        if super().__contains__(key):
            return super().__getitem__(key)
        if IMAGE_KEY.match(str(key)):
            return ("IMAGE",)
        raise KeyError(key)


def resolve_folder(folder):
    folder = os.path.expandvars(os.path.expanduser(str(folder or "").strip().strip('"')))
    base = folder_paths.get_output_directory()
    return os.path.abspath(os.path.join(base, folder)) if folder else os.path.abspath(base)


def to_card(img: Image.Image) -> Image.Image:
    if img.size == (CARD_W, CARD_H):
        return img
    box = media.crop_box(img.width, img.height, CARD_W, CARD_H, 1.0, 0.0, 0.0)
    return img.resize((CARD_W, CARD_H), Image.LANCZOS, box=box)


def file_stem(name, label):
    name = name.strip()
    if name and not name.endswith("_"):
        name += "_"
    stem = BAD_CHARS.sub("_", f"{name}{label}").strip().rstrip(". ")
    if not stem:
        raise ValueError(f"Card Save: '{name}{label}' is not a usable file name.")
    return stem


def slot_labels(unique_id, extra_pnginfo):
    workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
    if not isinstance(workflow, dict):
        return {}
    subgraphs = {s.get("id"): s for s in (workflow.get("definitions") or {}).get("subgraphs") or []}
    nodes, node = workflow.get("nodes") or [], None
    for part in str(unique_id).split(":"):
        node = next((n for n in nodes if str(n.get("id")) == part), None)
        if node is None:
            return {}
        nodes = (subgraphs.get(node.get("type")) or {}).get("nodes") or []
    return {i.get("name"): str(i.get("label") or "").strip() for i in node.get("inputs") or []}


def ordered_images(labels, kwargs):
    keys = sorted((k for k in kwargs if IMAGE_KEY.match(k) and kwargs[k] is not None),
                  key=lambda k: int(IMAGE_KEY.match(k).group(1)))
    return [(labels.get(k) or k, kwargs[k]) for k in keys]


def save_temp_preview(img: Image.Image):
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)
    name = f"card_save_{uuid.uuid4().hex[:10]}.png"
    preview = img.copy()
    preview.thumbnail((512, 512))
    preview.save(os.path.join(temp_dir, name), compress_level=1)
    return {"filename": name, "subfolder": "", "type": "temp"}


class DaCardSave:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": ([MODE_PREVIEW, MODE_SAVE], {"default": MODE_PREVIEW,
                         "tooltip": "Preview: only show the images. Save: show them and write them to the folder."}),
                "folder": ("STRING", {"default": "",
                           "tooltip": "Where Save writes the images. Empty = ComfyUI's output folder, a relative path is "
                                      "inside the output folder. Missing folders are created."}),
                "name": ("STRING", {"default": "",
                         "tooltip": "Put in front of each image input's name, joined with '_': name 'birdeye' + input 'normal' = birdeye_normal.png."}),
                "resize": ("BOOLEAN", {"default": False,
                           "tooltip": "Cut the middle of each image to the card's shape (490:684) and scale it to 490x684."}),
                "use_subfolder": ("BOOLEAN", {"default": False,
                                  "tooltip": "Save into a subfolder called the name without a trailing '_': "
                                             "name 'birdeye_' saves to <folder>/birdeye/birdeye_normal.png."}),
            },
            "optional": ImageInputs({
                "image_1": ("IMAGE", {"tooltip": "Connect an image to get another input. Double-click an input to name it: "
                                                 "it goes after the name in the file name."}),
            }),
            "hidden": {"unique_id": "UNIQUE_ID", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "DaCard"
    DESCRIPTION = ("Previews or saves any number of images as <name>_<input name>.png (a batch of frames as "
                   "<name>_<input name>_0001.png, ...), optionally cut and scaled to the card's 490x684.")

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def run(self, mode, folder, name, resize, use_subfolder=False, unique_id=None, extra_pnginfo=None, **kwargs):
        images = ordered_images(slot_labels(unique_id, extra_pnginfo), kwargs)
        if not images:
            raise ValueError("Card Save: connect at least one image.")

        saving = mode == MODE_SAVE
        out_dir = resolve_folder(folder)
        if saving and use_subfolder:
            subfolder = BAD_CHARS.sub("_", name.strip().rstrip("_")).strip().rstrip(". ")
            if not subfolder:
                raise ValueError("Card Save: use_subfolder names the subfolder after the name, so set a name.")
            out_dir = os.path.join(out_dir, subfolder)
        if saving:
            stems = [file_stem(name, label) for label, _ in images]
            dupes = sorted({s for s in stems if [x.lower() for x in stems].count(s.lower()) > 1})
            if dupes:
                raise ValueError(f"Card Save: more than one image input would be saved as {', '.join(dupes)}. Rename them.")
            os.makedirs(out_dir, exist_ok=True)

        shown = []
        for label, batch in images:
            frames = [media.tensor_to_pil(f) for f in batch]
            if resize:
                frames = [to_card(f) for f in frames]
            files = []
            if saving:
                stem = file_stem(name, label)
                if len(frames) == 1:
                    files.append(f"{stem}.png")
                else:
                    files += [f"{stem}_{i:04d}.png" for i in range(1, len(frames) + 1)]
                for frame, file in zip(frames, files):
                    frame.save(os.path.join(out_dir, file), compress_level=4)
            shown.append({
                **save_temp_preview(frames[0]),
                "name": label,
                "file": files[0] if len(files) == 1 else (f"{files[0]} … {files[-1]}" if files else ""),
                "size": f"{frames[0].width}x{frames[0].height}",
                "frames": len(frames),
            })

        return {"ui": {"cs_images": shown, "cs_folder": [out_dir if saving else ""]}}

