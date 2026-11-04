# Record

## Choosing sources

In the overview, click **+ Record**. The button only appears if your browser supports recording. Before you start, switch the sources on or off.

![The recording page before the start, with the three sources and the start button; numbered markers highlight the controls](shots/record.png)

1. **Microphone** switches the microphone on or off. It is on by default.
2. The **Microphone** field chooses the device. If there is only one device, the field shows its name.
3. **System audio** also records what your computer plays. It is off by default; see "System audio" below.
4. **Camera** also records the camera image. It is off by default; see "Camera" below.
5. **Start Recording** starts the recording (see "Recording").

A recording needs sound: switch on the microphone or system audio. The camera only adds the picture. If neither microphone nor system audio is on, the page shows **Turn on the microphone or system audio.** and **Start Recording** is disabled.

Your browser may ask for permission. If access is blocked, a notice with the button **Retry** appears. Allow access in your browser's site settings.

> **Get consent.** Before you start, the page reminds you: **Don't record people without their permission. Ask first!**

## Recording

Click **Start Recording**. A short beep signals the start. The display counts the duration up as hours:minutes:seconds, and a red dot pulses. A green bar shows the level; if the camera is on, you see the camera image instead. You cannot change the sources after the start.

While recording, **Pause**, **Stop** and **Discard** are available. After **Pause**, the first button reads **Resume**. **Discard** deletes the recording and returns to the start.

## After stopping

After **Stop**, transkribierBAR uploads the recording automatically (**Uploading recording...**). Then it continues as with uploading: you see the settings and click **Transcribe**. **Discard** is available here too. If the upload fails, an error message appears with **Retry** and **Discard**.

The file is named `recording-` followed by the date and time. The browser chooses the format: WebM if possible, otherwise MP4.

## System audio

With **System audio** you also record what your computer plays, such as an online meeting. The microphone is then mixed with the system audio; if you switch the microphone off, only system audio is recorded. The page marks the feature as experimental. What is possible depends on browser and operating system:

- **Chromium browsers on Windows (Chrome, Edge, Brave):** The browser lets you choose a screen or a tab. An entire screen gives all system audio, a tab gives only its sound.
- **Chromium browsers on other systems:** Only the sound of a browser tab is possible. Run the meeting in a tab and select that tab when the browser asks.
- **Firefox on Linux:** In the **System audio source** field, choose a second audio input device, for example a PulseAudio or PipeWire monitor source. Monitor sources whose names start with "Monitor of" are listed first there and are left out of the **Microphone** field as long as another device remains.
- **Firefox on other systems:** Support is limited. Use a Chromium browser instead.
- **Mobile devices and other browsers:** **System audio** is not offered.

While **System audio** is on, **Camera** is unavailable. If you stop sharing the screen or tab, the recording ends. If capturing fails, an error message appears, for example when you canceled the browser's selection.

## Camera

With **Camera** you also record a picture, which produces a video file. The sound comes from the microphone, which must be on. Pick the device in the **Camera** field. If there is no camera, it reads **No camera detected.** If the camera cannot be opened, the recording continues with sound only, and a message points this out.

## Leaving the page

If you close the tab or reload the page while recording, paused, or right after you have stopped a recording, the browser warns you.

> **Don't lose a recording.** If you switch to another view within transkribierBAR, for example with **← Transcriptions**, while recording or until you click **Transcribe**, you are asked first. If you confirm, the recording is discarded.
