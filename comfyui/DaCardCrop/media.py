import io

import av
import numpy as np
import torch
from PIL import Image


def crop_box(src_w, src_h, out_w, out_h, zoom, offset_x, offset_y):
    aspect = out_w / out_h
    if src_w / src_h > aspect:
        base_w, base_h = src_h * aspect, src_h
    else:
        base_w, base_h = src_w, src_w / aspect
    zoom = max(zoom, 1.0)
    cw, ch = base_w / zoom, base_h / zoom
    cx = src_w / 2 + max(-1.0, min(1.0, offset_x)) * (src_w - cw) / 2
    cy = src_h / 2 + max(-1.0, min(1.0, offset_y)) * (src_h - ch) / 2
    x0 = min(max(cx - cw / 2, 0.0), src_w - cw)
    y0 = min(max(cy - ch / 2, 0.0), src_h - ch)
    return x0, y0, x0 + cw, y0 + ch


def pixel_box(src_w, src_h, out_w, out_h, zoom, offset_x, offset_y):
    x0, y0, x1, y1 = crop_box(src_w, src_h, out_w, out_h, zoom, offset_x, offset_y)
    w = max(1, min(src_w, round(x1 - x0)))
    h = max(1, round(w * out_h / out_w))
    if h > src_h:
        h = src_h
        w = max(1, min(src_w, round(h * out_w / out_h)))
    left = min(max(round(x0), 0), src_w - w)
    top = min(max(round(y0), 0), src_h - h)
    return left, top, left + w, top + h


MODE_MAINTAIN, MODE_RESIZE = "maintain resolution", "resize"
MODES = [MODE_MAINTAIN, MODE_RESIZE]


class FrameCropper:
    def __init__(self, out_w, out_h, zoom, offset_x, offset_y, mode=MODE_RESIZE):
        self.out_w, self.out_h = out_w, out_h
        self.zoom, self.offset_x, self.offset_y = zoom, offset_x, offset_y
        self.mode = mode

    def __call__(self, img: Image.Image) -> np.ndarray:
        img = img.convert("RGB")
        if self.mode == MODE_MAINTAIN:
            box = pixel_box(img.width, img.height, self.out_w, self.out_h, self.zoom, self.offset_x, self.offset_y)
            out = img.crop(box)
        else:
            box = crop_box(img.width, img.height, self.out_w, self.out_h, self.zoom, self.offset_x, self.offset_y)
            out = img.resize((self.out_w, self.out_h), Image.LANCZOS, box=box)
        return np.asarray(out, dtype=np.float32) / 255.0


def _resample(timed_frames, fps, max_seconds, crop):
    out = []
    step = 1.0 / fps
    k = 0
    prev_t = prev_dur = prev_img = cached = None
    t0 = None
    for t, dur, img in timed_frames:
        if t0 is None:
            t0 = t
        t -= t0
        if prev_img is not None:
            while k * step < t and k * step < max_seconds:
                if cached is None:
                    cached = crop(prev_img)
                out.append(cached)
                k += 1
        if k * step >= max_seconds:
            break
        prev_t, prev_dur, prev_img, cached = t, dur, img, None
    if prev_img is not None:
        end = prev_t + (prev_dur or step)
        while (k * step < end and k * step < max_seconds) or not out:
            if cached is None:
                cached = crop(prev_img)
            out.append(cached)
            k += 1
    return out


def _decode_av(source, fps, max_seconds, crop, start=0.0, duration=0.0):
    if isinstance(source, io.BytesIO):
        source.seek(0)
    with av.open(source, mode="r") as container:
        stream = next(s for s in container.streams if s.type == "video")
        rate = float(stream.average_rate) if stream.average_rate else 10.0
        default_dur = 1.0 / rate

        def frames():
            n = 0
            for frame in container.decode(stream):
                t = frame.time if frame.time is not None else n * default_dur
                n += 1
                if t < start:
                    continue
                if duration > 0 and t > start + duration:
                    break
                dur = float(frame.duration * stream.time_base) if frame.duration and stream.time_base else default_dur
                yield t, dur, frame.to_image()

        return _resample(frames(), fps, max_seconds, crop)


def load_video_input(video, fps, max_seconds, crop):
    start, duration = 0.0, 0.0
    if hasattr(video, "get_active_trim_window"):
        start, duration = video.get_active_trim_window()
    if hasattr(video, "get_stream_source"):
        return _decode_av(video.get_stream_source(), fps, max_seconds, crop, start, duration)
    comp = video.get_components()
    rate = float(comp.frame_rate) or fps
    timed = ((i / rate, 1.0 / rate, tensor_to_pil(f)) for i, f in enumerate(comp.images))
    return _resample(timed, fps, max_seconds, crop)


def tensor_to_pil(frame: torch.Tensor) -> Image.Image:
    arr = (frame.clamp(0, 1).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
    if arr.shape[-1] == 1:
        arr = arr[..., 0]
    return Image.fromarray(arr)


def frames_to_tensor(frames) -> torch.Tensor:
    return torch.from_numpy(np.stack(frames, axis=0))
