import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import twin


class FakeClient:
    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def request(self, method, route, body=None, idempotency_key=None):
        self.calls.append((method, route, body, idempotency_key))
        if self.fail:
            raise RuntimeError("connection lost after submit")
        return {"video_id": "test_video", "status": "waiting", "output_format": "webm"}


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.job = Path(self.temp.name) / "job.json"
        self.body = twin.payload({"avatar_id": "test_avatar", "voice_id": "test_voice"}, "こんにちは。")

    def test_request_preserves_transparency_and_separate_captions(self):
        self.assertEqual(self.body["output_format"], "webm")
        self.assertNotIn("background", self.body)
        self.assertEqual(self.body["caption"], {"file_format": "srt"})
        self.assertEqual(self.body["script"], "こんにちは。")

    def test_no_second_charge_when_resubmitting_same_job(self):
        client = FakeClient()
        twin.submit(client, self.body, self.job)
        twin.submit(client, self.body, self.job)
        self.assertEqual(len(client.calls), 1)
        with self.assertRaises(ValueError):
            twin.submit(client, {**self.body, "script": "異なる台本"}, self.job)
        self.assertEqual(len(client.calls), 1)

    def test_lost_response_reuses_persisted_idempotency_key(self):
        client = FakeClient(fail=True)
        with self.assertRaises(RuntimeError):
            twin.submit(client, self.body, self.job)
        persisted = json.loads(self.job.read_text())
        self.assertEqual(persisted["request"], self.body)
        client.fail = False
        twin.submit(client, self.body, self.job)
        self.assertEqual(client.calls[0][3], client.calls[1][3])

    def test_expired_unknown_job_is_not_automatically_resubmitted(self):
        twin.save_json(self.job, {"request": self.body, "created_at": 0, "idempotency_key": "old"})
        client = FakeClient()
        with self.assertRaises(ValueError):
            twin.submit(client, self.body, self.job)
        self.assertFalse(client.calls)

    def test_missing_registered_identity_rejected(self):
        with self.assertRaises(ValueError):
            twin.payload({"avatar_id": "", "voice_id": ""}, "こんにちは。")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def make_video(self, transparent):
        target = self.root / ("alpha.webm" if transparent else "opaque.webm")
        frame = bytes(component for y in range(64) for x in range(64)
                      for component in (240, 100, 20, 255 if not transparent or 16 <= x < 48 and 16 <= y < 48 else 0))
        command = ["ffmpeg", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba",
                   "-video_size", "64x64", "-framerate", "10", "-i", "pipe:0",
                   "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-t", "1",
                   "-c:v", "libvpx-vp9", "-lossless", "1", "-pix_fmt", "yuva420p",
                   "-c:a", "libopus", str(target)]
        result = subprocess.run(command, input=frame * 10, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return target

    def test_webm_to_prores_preserves_alpha_audio_and_dimensions(self):
        source = self.make_video(True)
        result = twin.export_mov(source, self.root / "alpha.mov")
        self.assertEqual(result["alpha"]["alpha_min"], 0)
        self.assertEqual(result["alpha"]["alpha_max"], 255)
        streams = twin.probe(self.root / "alpha.mov")["streams"]
        video = next(s for s in streams if s["codec_type"] == "video")
        self.assertEqual((video["width"], video["height"]), (64, 64))
        self.assertEqual(video["profile"], "4444")
        self.assertTrue(any(s["codec_type"] == "audio" for s in streams))
        with self.assertRaises(ValueError):
            twin.export_mov(source, self.root / "alpha.mov")

    def test_opaque_clip_is_not_mislabelled_as_transparent(self):
        source = self.make_video(False)
        with self.assertRaises(ValueError):
            twin.export_mov(source, self.root / "opaque.mov")
        self.assertFalse((self.root / "opaque.mov").exists())


if __name__ == "__main__":
    unittest.main()
