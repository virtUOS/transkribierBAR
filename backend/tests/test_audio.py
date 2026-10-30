import asyncio
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
import pytest
from app.services import audio as audio_module
from app.services.audio import (
    convert_to_mp3, ensure_clean_asr_copy, get_media_duration, has_video_stream,
)


def _ffmpeg(*args):
    from app.services.audio import settings
    if shutil.which(settings.FFMPEG_PATH) is None:
        pytest.skip("ffmpeg not installed")
    subprocess.run([settings.FFMPEG_PATH, "-y", "-loglevel", "error", *args], check=True)


def _probe(path):
    from app.services.audio import settings
    return subprocess.run(
        [settings.FFPROBE_PATH, "-show_format", "-show_streams", "-show_chapters", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout


@pytest.mark.asyncio
async def test_mp3_tags_and_cover_stripped(tmp_path):
    cover = tmp_path / "cover.png"
    _ffmpeg("-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1", str(cover))
    src = tmp_path / "in.mp3"
    _ffmpeg(
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-i", str(cover),
        "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-c:v", "copy",
        "-id3v2_version", "3", "-metadata", "title=SECRET-TITLE",
        "-metadata:s:v", "title=Album cover", str(src),
    )
    original = src.read_bytes()
    assert "SECRET-TITLE" in _probe(src)

    result = await convert_to_mp3(str(src))

    assert result != str(src)
    assert result.endswith(".asr.mp3")
    probe = _probe(result)
    assert "SECRET-TITLE" not in probe
    assert "codec_type=video" not in probe
    assert src.read_bytes() == original


@pytest.mark.asyncio
async def test_mislabeled_mp3_is_reencoded(tmp_path):
    """A .mp3 name holding other audio cannot be stream-copied into MP3."""
    src = tmp_path / "in.mp3"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", "-f", "wav", str(src))

    result = await convert_to_mp3(str(src))

    assert result == str(tmp_path / "in.asr.mp3")
    assert "codec_name=mp3" in _probe(result)


@pytest.mark.asyncio
async def test_mp4_metadata_stripped(tmp_path):
    src = tmp_path / "in.mp4"
    _ffmpeg(
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-metadata", "title=SECRET-TITLE", "-metadata", "location=+52.27+008.04/",
        str(src),
    )
    probe = _probe(src)
    assert "SECRET-TITLE" in probe and "+52.2700+008.0400" in probe

    result = await convert_to_mp3(str(src))

    assert result == str(tmp_path / "in.mp3")
    probe = _probe(result)
    assert "SECRET-TITLE" not in probe
    assert "+52.2700+008.0400" not in probe


@pytest.mark.asyncio
async def test_convert_nonexistent_file_raises():
    with pytest.raises(FileNotFoundError):
        await convert_to_mp3("/nonexistent/file.wav")


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["in.wav", "in.mp3"])
async def test_failed_conversion_removes_partial_output(tmp_path, monkeypatch, name):
    from app.services.audio import settings
    fake_ffmpeg = tmp_path / "ffmpeg"
    # Like ffmpeg, writes the output file (last argument) before failing.
    fake_ffmpeg.write_text('#!/bin/sh\nfor a; do last="$a"; done\necho partial > "$last"\nexit 1\n')
    fake_ffmpeg.chmod(0o755)
    monkeypatch.setattr(settings, "FFMPEG_PATH", str(fake_ffmpeg))
    work = tmp_path / "work"
    work.mkdir()
    src = work / name
    src.write_bytes(b"not audio")

    with pytest.raises(RuntimeError):
        await convert_to_mp3(str(src))

    assert os.listdir(work) == [name]


@pytest.mark.asyncio
async def test_legacy_passthrough_mp3_gets_a_clean_copy(tmp_path):
    """Before the ASR copy was cleaned, an MP3 upload was its own ASR copy."""
    src = tmp_path / "in.mp3"
    _ffmpeg(
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libmp3lame",
        "-id3v2_version", "3", "-metadata", "title=SECRET-TITLE", str(src),
    )
    original = src.read_bytes()

    result = await ensure_clean_asr_copy(str(src), str(src))

    assert result == str(tmp_path / "in.asr.mp3")
    assert "SECRET-TITLE" not in _probe(result)
    assert src.read_bytes() == original


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["title", "cover", "chapter"])
async def test_legacy_converted_copy_stripped_in_place(tmp_path, kind):
    """Before the ASR copy was cleaned, conversion kept the upload's metadata."""
    work = tmp_path / "work"
    work.mkdir()
    asr = work / "in.mp3"
    if kind == "title":
        _ffmpeg(
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
            "-id3v2_version", "3", "-metadata", "title=SECRET-TITLE", str(asr),
        )
    elif kind == "cover":
        cover = tmp_path / "cover.png"
        _ffmpeg("-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1", str(cover))
        _ffmpeg(
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-i", str(cover),
            "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-id3v2_version", "3", str(asr),
        )
    else:
        meta = tmp_path / "meta.txt"
        meta.write_text(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=500\ntitle=SECRET-TITLE\n")
        _ffmpeg(
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-i", str(meta),
            "-map_chapters", "1", "-id3v2_version", "3", str(asr),
        )
    before = _probe(asr)
    assert "SECRET-TITLE" in before or "codec_type=video" in before

    result = await ensure_clean_asr_copy(str(tmp_path / "in.mp4"), str(asr))

    assert result == str(asr)
    probe = _probe(asr)
    assert "SECRET-TITLE" not in probe
    assert "codec_type=video" not in probe
    assert "[CHAPTER]" not in probe
    assert os.listdir(work) == ["in.mp3"]


@pytest.mark.asyncio
async def test_clean_asr_copy_untouched(tmp_path):
    asr = tmp_path / "in.mp3"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", str(asr))
    os.utime(asr, (1_000_000_000, 1_000_000_000))

    result = await ensure_clean_asr_copy(str(tmp_path / "in.mp4"), str(asr))

    assert result == str(asr)
    assert asr.stat().st_mtime == 1_000_000_000


@pytest.mark.asyncio
async def test_failed_conversion_error_has_no_file_tags():
    # A short path keeps the tags inside the last 500 characters of ffmpeg's output.
    work = pathlib.Path(tempfile.mkdtemp(dir="/tmp", prefix="a"))
    src = work / "in.wav"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-metadata", "title=SECRET-TAG", str(src))
    work.chmod(0o555)  # the output cannot be written, so ffmpeg fails after reading the tags
    try:
        with pytest.raises(RuntimeError) as excinfo:
            await convert_to_mp3(str(src))
    finally:
        work.chmod(0o755)
        shutil.rmtree(work)

    assert "SECRET-TAG" not in str(excinfo.value)


@pytest.mark.asyncio
async def test_new_asr_copy_has_no_chapters(tmp_path):
    chapters = tmp_path / "chapters.txt"
    chapters.write_text(
        ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=500\ntitle=SECRET-CHAPTER\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=500\nEND=1000\ntitle=Second\n"
    )
    src = tmp_path / "in.m4a"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-i", str(chapters),
            "-map_metadata", "1", "-c:a", "aac", str(src))
    assert "[CHAPTER]" in _probe(src)  # the fixture really has chapters

    out = await convert_to_mp3(str(src))

    assert "[CHAPTER]" not in _probe(out)
    os.utime(out, (1_000_000_000, 1_000_000_000))
    assert await ensure_clean_asr_copy(str(src), out) == out
    assert os.stat(out).st_mtime == 1_000_000_000


# --- probing helpers and failure paths --------------------------------------


@pytest.mark.asyncio
async def test_ensure_clean_copy_raises_when_ffprobe_cannot_read(tmp_path):
    if shutil.which(audio_module.settings.FFPROBE_PATH) is None:
        pytest.skip("ffprobe not installed")
    bogus = tmp_path / "in.mp3"
    bogus.write_bytes(b"definitely not audio")
    with pytest.raises(RuntimeError, match="ffprobe failed"):
        await ensure_clean_asr_copy(str(tmp_path / "in.mp4"), str(bogus))


@pytest.mark.asyncio
async def test_ensure_clean_copy_keeps_original_when_stripping_fails(tmp_path, monkeypatch):
    work = tmp_path / "work"
    work.mkdir()
    asr = work / "in.mp3"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=1",
            "-id3v2_version", "3", "-metadata", "title=SECRET-TITLE", str(asr))
    before = asr.read_bytes()

    async def _fail(_in, _out, _codec):
        return "ffmpeg said no"

    monkeypatch.setattr(audio_module, "_write_without_metadata", _fail)
    with pytest.raises(RuntimeError, match="Metadata removal failed: ffmpeg said no"):
        await ensure_clean_asr_copy(str(tmp_path / "in.mp4"), str(asr))
    assert asr.read_bytes() == before
    assert os.listdir(work) == ["in.mp3"]  # temp file cleaned up


@pytest.mark.asyncio
async def test_media_duration_and_video_detection(tmp_path):
    audio = tmp_path / "a.mp3"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=2", str(audio))
    video = tmp_path / "v.mp4"
    _ffmpeg("-f", "lavfi", "-i", "color=c=red:s=16x16:d=1", "-f", "lavfi", "-i", "sine=duration=1",
            "-shortest", str(video))

    assert 1.9 < await get_media_duration(str(audio)) < 2.2
    assert await has_video_stream(str(audio)) is False
    assert await has_video_stream(str(video)) is True


@pytest.mark.asyncio
async def test_probes_fail_soft(tmp_path, monkeypatch):
    garbage = tmp_path / "g.mp3"
    garbage.write_bytes(b"junk")
    assert await get_media_duration(str(garbage)) is None
    assert await has_video_stream(str(garbage)) is False

    monkeypatch.setattr(audio_module.settings, "FFPROBE_PATH", str(tmp_path / "no-such-ffprobe"))
    assert await get_media_duration(str(garbage)) is None
    assert await has_video_stream(str(garbage)) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("probe", [get_media_duration, has_video_stream])
async def test_cancelled_probe_kills_ffprobe(tmp_path, monkeypatch, probe):
    pidfile = tmp_path / "pid"
    fake = tmp_path / "fake-ffprobe"
    fake.write_text(f"#!/bin/sh\necho $$ > {shlex.quote(str(pidfile))}\nexec sleep 30\n")
    fake.chmod(0o755)
    monkeypatch.setattr(audio_module.settings, "FFPROBE_PATH", str(fake))

    task = asyncio.create_task(probe(str(tmp_path / "x.mp3")))
    try:
        for _ in range(500):
            if pidfile.exists() and pidfile.read_text().strip():
                break
            await asyncio.sleep(0.01)
        else:
            pytest.fail("fake ffprobe never started")
        pid = int(pidfile.read_text())
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        task.cancel()  # no-op once the task is done; stops the probe on failure
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
