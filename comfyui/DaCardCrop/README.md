# DaCardCrop

One ComfyUI node for the **DaCard** SPT mod: **Card Crop (490x684)**, category **DaCard**. It cuts a picture, GIF or
video to card size so you can run depth and normal estimation on it (any depth / normal nodes you like) and use the
results as a card's **3D layer** in the Card Creator (albedo, depth map, normal map).

Install: extract `DaCardCrop.zip` (Card Creator ▸ New card ▸ 3D layer ▸ *Download Card Crop node*) into ComfyUI's
`custom_nodes`, so you have `custom_nodes/DaCardCrop/nodes.py`, and restart ComfyUI. Needs `av` (PyAV), which
ComfyUI already ships with.

## Card Crop (490x684)

- Source: its own **file** picker (pictures, GIFs and videos in ComfyUI's `input` folder; upload button for pictures),
  or a connected **video** (e.g. *Load Video*, trim settings respected) or **image** (single picture or a batch of frames).
- **Live preview:** drag = move the cut, mouse wheel = zoom, double-click = reset. Values go into `zoom`, `offset_x`, `offset_y`.
- **mode**:
  - `maintain resolution`: only cuts to the card's shape (490:684), keeping the source's pixels (a 1920x1080 video
    at zoom 1 gives 774x1080 frames). Best for depth / normal estimation.
  - `resize` (default): cuts and scales every frame to 490x684 (`width` / `height`, advanced; in `maintain resolution`
    they only set the shape).
- Videos and GIFs are decoded one frame at a time and **resampled to 12 fps** (`fps`). `max_seconds` caps the clip
  length. An image batch is taken as already being at the card fps.
- Outputs `frames` (IMAGE batch), `fps`, `frame_count`.

## Making a 3D layer with it

The ready workflow `comfyui/workflows/3DCardGen.json` (Card Creator: *Download workflow*) does this with built-in
ComfyUI nodes: Load Image → Card Crop → MoGe depth, MoGe normals (OpenGL) and BiRefNet background removal (cut-out +
mask), each into a preview. By hand:

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
