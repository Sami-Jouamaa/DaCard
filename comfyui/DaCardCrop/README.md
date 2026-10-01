# DaCardCrop

ComfyUI nodes for the **DaCard** SPT mod, category **DaCard**:

- **Card Crop (490x684)** cuts a picture, GIF or video to card size so you can run depth and normal estimation on it
  (any depth / normal nodes you like) and use the results as a card's **3D layer** in the Card Creator (albedo, depth
  map, normal map).
- **Card Save** previews or saves any number of images under names you pick, e.g. `birdeye_albedo.png`,
  `birdeye_depth.png`, `birdeye_normal.png`.

Install: extract `DaCardCrop.zip` (Card Creator ▸ New card ▸ 3D layer ▸ *Download Card Crop node*) into ComfyUI's
`custom_nodes`, so you have `custom_nodes/DaCardCrop/nodes.py`, and restart ComfyUI. Needs `av` (PyAV), which
ComfyUI already ships with.

## Card Crop (490x684)

- Source: a connected **video** (e.g. *Load Video* for videos and GIFs, trim settings respected) or **image** (e.g.
  *Load Image*: a single picture or a batch of frames).
- **Crop selection:** drag = move the cut, mouse wheel = zoom, double-click = reset. Values go into `zoom`, `offset_x`,
  `offset_y`.
- **mode**:
  - `maintain resolution`: only cuts to the card's shape (490:684), keeping the source's pixels (a 1920x1080 video
    at zoom 1 gives 774x1080 frames). Best for depth / normal estimation.
  - `resize` (default): cuts and scales every frame to 490x684 (`width` / `height`, advanced; in `maintain resolution`
    they only set the shape).
- Videos and GIFs are decoded one frame at a time and **resampled to 12 fps** (`fps`). `max_seconds` caps the clip
  length. An image batch is taken as already being at the card fps.
- Outputs `frames` (IMAGE batch), `fps`, `frame_count`.

## Card Save

- **Image inputs**: connecting an image adds another input. Name an input by double-clicking it (or right-click it ▸
  *Rename Slot*, or right-click the node ▸ *Rename image input "…"*). An empty name goes back to the default:
  `image_1`, `image_2`, …
- **mode**: `Preview` only shows the images; `Save` shows them and writes them to the folder.
- **folder**: where `Save` writes. Empty = ComfyUI's `output` folder, a relative path is inside it, or any absolute
  path. Missing folders are created.
- **name** + `_` + the input's name = the file name: name `birdeye` (or `birdeye_`) and input `normal` give
  `birdeye_normal.png`.
  Existing files are overwritten; two inputs that would get the same file name stop the run.
- **resize**: cuts the middle of each image to the card's shape (490:684) and scales it to 490x684.
- **use_subfolder**: saves into a subfolder named after **name**, without a trailing `_`: name `birdeye_` saves
  to `<folder>/birdeye/birdeye_normal.png`. Needs a name.
- A batch of frames is saved as an image sequence: `birdeye_normal_0001.png`, `birdeye_normal_0002.png`, …
- The preview shows each input's first frame with its name, file name and size; click one to open it full size.
- Card Save runs on every queue, so renaming an input alone re-saves the files under the new name.

## Making a 3D layer with it

The ready workflow `comfyui/workflows/CardGen.json` (Card Creator: *Download workflow*) does this: Load Image (or Load
Video) → Card Crop → the *CardGen* subgraph (MoGe depth and normals, BiRefNet background removal, Chord roughness) →
Card Save, which writes `fg`, `bg`, `depth`, `normal`, `roughness` and `mask` as `birdeye/birdeye_<map>.png` (set
`mode` to `Save`). Chord needs the [ComfyUI-Chord](https://github.com/ubisoft/ComfyUI-Chord) custom node and
`chord_v1.safetensors` (linked in the workflow's note). By hand:

```
Card Crop ── frames ──┬─► Save Image (or Save Animated / image sequence)   → the albedo
                      ├─► depth estimation ──► Save Image                   → the depth map
                      └─► normal estimation ─► Save Image                   → the normal map
```

- **Depth map**: grayscale, white = near, black = far, same size as the frames.
- **Normal map**: tangent space, OpenGL convention (green = up).
- Clips: keep the three outputs frame for frame (same `fps`, same count). The Card Creator takes each map as an
  image, an image sequence or a video / GIF.

Then in the Card Creator: New card ▸ Front ▸ switch on the **3D layer** and drop the albedo, depth map and normal map in.
