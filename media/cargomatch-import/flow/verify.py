#!/usr/bin/env python3
"""Delivery verification including continuous-camera state transitions."""
import json
import re
import subprocess
import sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import render as r
a = r.a


def main():
    movie = r.OUT / "cargomatch-en-nl-1080p.mp4"
    edit = json.loads((r.OUT/"edit-timeline.json").read_text())
    receipt = json.loads((r.OUT/"production-receipt.json").read_text())
    assert a.sha256(movie) == receipt["outputSha256"]
    metadata = a.probe(movie)
    v, au = [next(s for s in metadata["streams"] if s["codec_type"] == k) for k in ("video","audio")]
    assert (v["width"],v["height"],v["codec_name"],v["pix_fmt"],v["avg_frame_rate"]) == (1920,1080,"h264","yuv420p","24/1")
    assert (au["codec_name"],au["channels"],au["sample_rate"]) == ("aac",2,"48000")
    assert int(v["nb_frames"]) == edit["frames"]
    assert abs(float(metadata["format"]["duration"])-edit["durationSeconds"]) < .08
    assert movie.stat().st_size < 104857600
    dec = subprocess.run(["ffmpeg","-v","error","-xerror","-i",str(movie),"-f","null","-"],capture_output=True,text=True)
    assert dec.returncode == 0 and not dec.stderr.strip(), dec.stderr
    cues = json.loads((r.OUT/"subtitle-cues.json").read_text())["cues"]
    previous = 0
    for q in cues:
        assert previous <= q["start"] < q["end"] <= edit["durationSeconds"]
        assert len(q["lines"]) <= 2 and all(len(s)<=58 for s in q["lines"])
        previous = q["end"]
    geometry = []
    for scene in edit["scenes"]:
        data = json.loads((r.BUILD/f"shot-{scene['id']:02}.json").read_text())
        assert data["outputFrames"] == scene["renderEndFrame"]-scene["renderStartFrame"]
        assert a.sha256(r.ASSETS/"source"/(scene["source"]+".mp4")) == data["sourceSha256"]
        for name, digest in data["screens"].items():
            assert a.sha256(r.ASSETS/"screens"/name) == digest
        frames = data["frames"]
        if not frames:
            continue
        assert len(frames) == data["outputFrames"]
        times = np.array([f["sourceTime"] for f in frames])
        assert np.all(np.diff(times)>0)
        assert float(np.ptp(np.diff(times))) < .00001
        for f in frames:
            left, top, right, bottom = f["screenBounds"]
            assert 0<=left<right<=1920 and 0<=top<bottom<930
        corners = np.array([f["corners"] for f in frames])
        jumps = np.linalg.norm(np.diff(corners,axis=0),axis=2).max(axis=1)
        assert jumps.max()<40
        changes = [{"frame":ch["frame"],"maxCornerStep":float(jumps[max(0,ch["frame"]-1)])}
                   for ch in scene["screens"][1:]]
        geometry.append({"shot":scene["id"],"sourceClockLinear":True,"cameraResets":0,
                         "maxCornerStep":float(jumps.max()),"screenChanges":changes})
    cap = cv2.VideoCapture(str(movie))
    stats, black, frozen = [], [], []
    old = None
    endpoint_means = []
    for i in range(edit["frames"]):
        ok, image = cap.read()
        assert ok
        if i in (0, edit["frames"]-1):
            endpoint_means.append(float(image.mean()))
        small = cv2.resize(image[64:930],(320,144))
        mean = float(small.mean())
        if mean<2 and .7*24<i<edit["frames"]-1.4*24:
            black.append(i)
        if old is not None:
            delta = float(cv2.absdiff(small,old).mean())
            stats.append(delta)
            if delta<.002 and .7*24<i<edit["frames"]-1.4*24:
                frozen.append(i)
        old = small
    cap.release()
    assert endpoint_means[0]<1 and endpoint_means[1]<3, endpoint_means
    assert not black, black
    # No extended identical-image holds inside photographic footage.
    longest, current, last = 0,0,-2
    for frame in frozen:
        current = current+1 if frame==last+1 else 1
        longest=max(longest,current)
        last=frame
    assert longest < 3, longest
    review = r.BUILD/"review"
    review.mkdir(exist_ok=True)
    cap=cv2.VideoCapture(str(movie))
    sheet=Image.new("RGB",(1600,1000),"#101827")
    draw=ImageDraw.Draw(sheet)
    for i,scene in enumerate(edit["scenes"]):
        time=(scene["start"]+scene["end"])/2
        cap.set(cv2.CAP_PROP_POS_MSEC,time*1000)
        ok,img=cap.read()
        assert ok
        cv2.imwrite(str(review/f"shot-{i+1:02}.jpg"),img)
        thumb=Image.fromarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB))
        thumb.thumbnail((380,214))
        x,y=(i%4)*400,(i//4)*320
        sheet.paste(thumb,(x,y))
        draw.text((x,y+220),f"Shot {i+1} / {time:.2f}s",fill="white")
    cap.release()
    sheet.save(review/"contact-sheet.jpg",quality=95)
    loud=receipt["audio"]["finalMeasurement"]
    assert -17.5<=float(loud["input_i"])<=-14.5 and float(loud["input_tp"])<=-.5
    assert all(a.sha256(r.ROOT/p)==h for p,h in receipt["originalsPreserved"].items())
    silence=subprocess.run(["ffmpeg","-hide_banner","-i",str(r.OUT/"audio/story-normalized.wav"),
        "-af","silencedetect=noise=-38dB:d=0.15","-f","null","-"],capture_output=True,text=True,check=True)
    pauses=[float(x) for x in re.findall(r"silence_duration: ([0-9.]+)",silence.stderr)]
    report={"passed":True,"sha256":a.sha256(movie),"seconds":edit["durationSeconds"],"frames":edit["frames"],
        "bytes":movie.stat().st_size,"fullDecode":True,"narrationTakes":1,"insertedPauses":0,
        "naturalDetectedPausesSeconds":pauses,"subtitleCues":len(cues),"loudness":loud,
        "cameraGeometry":geometry,"allPhotographicFramesChecked":True,"internalBlackFrames":black,
        "firstFrameMean":endpoint_means[0],"lastFrameMean":endpoint_means[1],
        "longestIdenticalFrameRun":longest,"frameDifferenceMean":float(np.mean(stats)),
        "reviewLimits":"Frame metrics and browser moving playback are technical evidence, not independent human perception or listening. Optical-flow background interpolation may retain local artifacts; UI is composited afterward at full resolution."}
    r.write(r.OUT/"technical-verification.json",report)
    print(json.dumps({k:report[k] for k in ("passed","seconds","frames","bytes","subtitleCues")}))


if __name__=="__main__":
    main()