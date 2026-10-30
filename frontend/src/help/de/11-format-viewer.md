# Formatansicht

## Die vier Formate

Neben **Untertitel** hat die Detailansicht die Reiter **SRT**, **VTT**, **JSON** und **TXT**. Jeder zeigt das Transkript in diesem Format. transkribierBAR erstellt es in Ihrem Browser aus dem aktuellen Text.

- **SRT:** nummerierte Einträge mit Zeitangaben wie `00:01:30,250 --> 00:01:34,000`. Der Text beginnt mit dem Namen der sprechenden Person in eckigen Klammern: `[Name]: Text`.
- **VTT:** beginnt mit `WEBVTT` und hat Zeitangaben mit Punkt statt Komma (`00:01:30.250`). Die Namen stehen wie bei SRT in eckigen Klammern.
- **JSON:** eine Liste mit `start`, `end`, `text` und `speaker` je Äußerung. Start und Ende sind Millisekunden.
- **TXT:** eine Zeile je Äußerung ohne Zeitangaben, in der Form `Name: Text`.

Äußerungen ohne sprechende Person erscheinen ohne Namen.

## Herunterladen

Jeder Format-Reiter hat eine Vorschau und eine Schaltfläche zum Herunterladen.

![Der Reiter „SRT“ mit der Vorschau und der Schaltfläche zum Herunterladen; nummerierte Markierungen heben die Bedienelemente hervor](shots/formats.png)

1. Der Reiter **SRT**. **VTT**, **JSON** und **TXT** funktionieren genauso.
2. Die Vorschau, die Sie nicht ändern können.
3. **Herunterladen SRT** speichert die Datei. Dieselbe Schaltfläche steht auch unter der Vorschau.

Die Datei bekommt den Namen der Aufnahme ohne Endung plus Dateiendung des Formats, etwa `Vorlesung.srt`. Fehlt der Name, heißt die Datei `transcription.srt`.

## Was im Format steht

Das Format zeigt den Stand, den Sie im Editor sehen, auch mit ungespeicherten Änderungen. Namen aus **Namen der Sprechenden** sind in allen vier Formaten und in jeder Ansicht eingesetzt.

Welche Fassung erscheint, richtet sich nach der Ansicht, die Sie im Reiter **Untertitel** zuletzt gewählt haben: **Original**, **Verfeinert** oder **Übersetzt**. Ist **Verfeinert** gewählt, enthält das JSON-Format beide Fassungen in einem Objekt: `utterances` für das Original und `refined_utterances` für die verfeinerte Fassung.

## Welches Format passt?

| Ziel | Format |
|---|---|
| Untertitel zu einem Video hinzufügen | SRT oder VTT |
| Das Transkript mit einem Programm weiterverarbeiten | JSON |
| Das Transkript lesen oder weitergeben | TXT |
