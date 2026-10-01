import os
import uuid

import folder_paths
from PIL import Image

from . import media
from .card_save import DaCardSave

CARD_W, CARD_H, CARD_FPS = 490, 684, 12.0


def _save_temp_preview(img: Image.Image, prefix: str):
    temp_dir = folder_paths.get_temp_directory()
    os.makedirs(temp_dir, exist_ok=True)
    name = f"{prefix}_{uuid.uuid4().hex[:10]}.png"
    img.save(os.path.join(temp_dir, name), compress_level=1)
    return {"filename": name, "subfolder": "", "type": "temp"}


class DaCardCrop:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (media.MODES, {"default": media.MODE_RESIZE,
                         "tooltip": "maintain resolution: only cut to the card's shape (width:height), keeping the source's pixels. "
                                    "resize: cut and scale to width x height (490x684)."}),
                "zoom": ("FLOAT", {"default": 1.0, "min": 1.0, "max": 8.0, "step": 0.01,
                         "tooltip": "1 = largest card-shaped cut that fits. Scroll on the preview to change."}),
                "offset_x": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.001,
                             "tooltip": "-1 = left edge, 1 = right edge. Drag on the preview to change."}),
                "offset_y": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.001,
                             "tooltip": "-1 = top edge, 1 = bottom edge. Drag on the preview to change."}),
                "fps": ("FLOAT", {"default": CARD_FPS, "min": 1.0, "max": 60.0, "step": 1.0,
                        "tooltip": "Card frame rate. Videos and GIFs are resampled to this."}),
                "max_seconds": ("FLOAT", {"default": 10.0, "min": 0.1, "max": 120.0, "step": 0.1,
                                "tooltip": "Stops after this much of the clip (every frame becomes a card frame)."}),
                "width": ("INT", {"default": CARD_W, "min": 16, "max": 4096, "step": 1, "advanced": True,
                          "tooltip": "resize: output width. maintain resolution: only the shape (width:height)."}),
                "height": ("INT", {"default": CARD_H, "min": 16, "max": 4096, "step": 1, "advanced": True,
                           "tooltip": "resize: output height. maintain resolution: only the shape (width:height)."}),
            },
            "optional": {
                "video": ("VIDEO", {"tooltip": "e.g. from Load Video (videos and GIFs). Takes priority over 'image'."}),
                "image": ("IMAGE", {"tooltip": "e.g. from Load Image: a picture or a batch of frames (a batch is taken as already at the card fps)."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "FLOAT", "INT")
    RETURN_NAMES = ("frames", "fps", "frame_count")
    FUNCTION = "run"
    CATEGORY = "DaCard"
    DESCRIPTION = ("Cuts a picture, GIF or video to the card's shape (490:684), at the source's resolution or resized to "
                   "490x684, and resamples animations to the card frame rate, ready for depth and normal estimation. "
                   "Its frames are the 3D layer's albedo in the Card Creator.")

    def run(self, zoom, offset_x, offset_y, fps, max_seconds, width, height, mode=media.MODE_RESIZE, video=None, image=None):
        crop = media.FrameCropper(width, height, zoom, offset_x, offset_y, mode)
        source_preview = None

        if video is not None:
            frames = media.load_video_input(video, fps, max_seconds, crop)
        elif image is not None:
            pics = [media.tensor_to_pil(f) for f in image]
            source_preview = pics[0]
            frames = [crop(p) for p in pics[: max(1, int(round(max_seconds * fps)))]]
        else:
            raise ValueError("Card Crop: connect a video or an image.")

        out = media.frames_to_tensor(frames)
        ui = {}
        if source_preview is not None:
            source_preview.thumbnail((1024, 1024))
            ui["cc_source"] = [_save_temp_preview(source_preview, "card_source")]
        return {"ui": ui, "result": (out, float(fps), int(out.shape[0]))}


NODE_CLASS_MAPPINGS = {
    "DaCardCrop": DaCardCrop,
    "DaCardSave": DaCardSave,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DaCardCrop": "Card Crop (490x684)",
    "DaCardSave": "Card Save",
}
