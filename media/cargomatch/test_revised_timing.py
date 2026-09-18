#!/usr/bin/env python3
"""Cheap contract checks for the entire speech-led edit, before costly encoding."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "attached_assets/cargomatch/revised"


class RevisedTimingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.timeline = json.loads((OUT / "edit-timeline.json").read_text())
        cls.cues = json.loads((OUT / "subtitle-cues.json").read_text())["cues"]
        cls.script = json.loads((ROOT / "media/cargomatch/production.json").read_text())
        cls.manifest = json.loads((ROOT / "media/cargomatch/revised-narration.json").read_text())

    def test_all_content_preserved_in_order(self):
        self.assertEqual([s["id"] for s in self.timeline["scenes"]], list(range(1, 25)))
        self.assertEqual(sorted({c["slotId"] for c in self.cues}), list(range(1, 25)))
        original = " ".join(i["en"] for i in self.script["narration"])
        self.assertEqual(" ".join(g["text"] for g in self.manifest["groups"]), original)
        for item in self.script["narration"]:
            actual = " ".join(c["dutch"] for c in self.cues if c["slotId"] == item["id"])
            self.assertEqual(actual, item["nl"])

    def test_frame_grid_and_continuity(self):
        t = self.timeline
        self.assertAlmostEqual(t["frames"] / t["fps"], t["durationSeconds"])
        self.assertLessEqual(t["durationSeconds"], 180)
        self.assertEqual(t["scenes"][0]["renderStartFrame"], 0)
        self.assertEqual(t["scenes"][-1]["renderEndFrame"], t["frames"])
        for previous, current, transition in zip(t["scenes"], t["scenes"][1:], t["transitions"]):
            self.assertEqual(previous["end"], current["start"])
            overlap = previous["renderEndFrame"] - current["renderStartFrame"]
            self.assertAlmostEqual(overlap / t["fps"], transition["duration"])
            self.assertAlmostEqual(current["renderStartFrame"] / t["fps"], transition["start"])
            self.assertGreater(current["renderEndFrame"], current["renderStartFrame"])
            self.assertLessEqual(transition["duration"], .5)

    def test_voice_not_accelerated_or_padded_with_long_gaps(self):
        self.assertEqual(self.timeline["voiceTimeStretch"], 1)
        self.assertEqual(self.manifest["voice"]["voiceSettings"]["speed"], 1)
        for a, b in zip(self.timeline["groups"], self.timeline["groups"][1:]):
            self.assertAlmostEqual(b["start"] - a["end"], .55)
        self.assertGreater(self.timeline["groups"][0]["start"], 0)
        self.assertGreater(self.timeline["durationSeconds"] - self.timeline["groups"][-1]["end"], 1)

    def test_captions_fit_timeline_and_readable_area(self):
        previous_end = 0
        for cue in self.cues:
            duration = cue["end"] - cue["start"]
            self.assertGreaterEqual(cue["start"], previous_end)
            self.assertGreaterEqual(duration, 1)
            self.assertLess(cue["end"], self.timeline["durationSeconds"] - 1)
            self.assertLessEqual(len(cue["lines"]), 2)
            self.assertTrue(all(len(line) <= 58 for line in cue["lines"]))
            self.assertLess(len(cue["dutch"]) / duration, 27)
            previous_end = cue["end"]


if __name__ == "__main__":
    unittest.main()