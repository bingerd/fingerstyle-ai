"""Audio -> MIDI with Spotify's basic-pitch (ONNX model). Usage: transcribe.py <in-audio> <out.mid>"""
import sys
from pathlib import Path

from basic_pitch import ICASSP_2022_MODEL_PATH
from basic_pitch.inference import Model, predict


def main(src: str, dst: str) -> None:
    onnx = Path(ICASSP_2022_MODEL_PATH).with_suffix(".onnx")
    model = Model(onnx if onnx.exists() else ICASSP_2022_MODEL_PATH)
    _, midi, _ = predict(
        src,
        model,
        onset_threshold=0.6,      # fewer ghost onsets on full mixes
        frame_threshold=0.35,
        minimum_note_length=80,   # ms
        melodia_trick=True,
    )
    midi.write(dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
