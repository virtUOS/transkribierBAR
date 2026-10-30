# Hochladen

## Datei auswählen

Klicken Sie in der Übersicht auf **+ Hochladen**. Ziehen Sie dann eine Datei in den Upload-Bereich oder klicken Sie darauf, um den Datei-Browser zu öffnen. Der Upload beginnt sofort nach der Auswahl.

Erlaubt sind MP3, WAV, MP4, WebM, M4A, MOV, AAC, Opus und OGG bis zu 1 GB. Ist die Datei größer, erscheint die Meldung **Datei ist zu groß. Maximale Größe ist 1 GB.** Während des Uploads steht dort **Datei wird hochgeladen — bitte warten...**. Danach zeigt die Seite den Dateinamen mit der Dateigröße.

## Einstellungen und Start

Sobald Sie eine Datei gewählt haben, erscheinen die Einstellungen, auch schon während des Uploads.

![Die Seite „Hochladen“ nach der Dateiauswahl mit den Einstellungen und den Schaltflächen zum Starten; nummerierte Markierungen heben die Bedienelemente hervor](shots/upload.png)

1. Die Einstellungen. Was die Felder bedeuten, steht im Abschnitt „Transkriptionseinstellungen“; das Feld **Pakete** erklärt „Pakete verwenden“ weiter unten.
2. **Transkribieren** startet die Transkription.
3. **Verwerfen** setzt die Seite zurück und führt Sie zur Übersicht zurück.

Läuft der Upload noch, heißt die Schaltfläche **Transkribieren wenn bereit**; die Transkription startet dann von selbst, sobald die Datei hochgeladen ist. Schlägt der Upload in diesem Fall fehl, erscheint **Upload fehlgeschlagen** mit der Schaltfläche **Einstellungen ändern**.

## Pakete verwenden

Ein Paket verbindet Voreinstellungen für Transkription, Verfeinerung, Analyse und Übersetzung. Haben Sie Pakete angelegt, wählen Sie unter **Voreinstellungen** im Feld **Pakete** eines aus. Ist ein Paket als Standard markiert, wählt die Anwendung es beim Öffnen vor und übernimmt die Einstellungen seiner Transkriptions-Voreinstellung, so als hätten Sie das Paket selbst ausgewählt. Markieren Sie ein Paket als Standard, während die Anwendung offen ist, zeigt das Feld **Pakete** es an, seine Transkriptions-Voreinstellung wird aber erst beim nächsten Öffnen übernommen. Um sie sofort zu übernehmen, wählen Sie zuerst **Paket wählen...** und danach das Paket aus.

Enthält das Paket Verfeinerung, Analyse oder Übersetzung, heißt die Schaltfläche **Pipeline starten**. Diese Schritte startet Ihr Browser nach der Transkription automatisch. Bleiben Sie auf der Seite, bis sie fertig sind. Pakete legen Sie auf der Seite **Voreinstellungen** an.

## Seite verlassen

Solange die Datei hochgeladen wird, fragt transkribierBAR beim Wechsel in eine andere Ansicht nach: **Ein Upload läuft gerade. Wenn Sie die Seite verlassen, wird er abgebrochen. Fortfahren?** Bestätigen Sie, bricht der Upload ab. Schließen Sie den Tab oder laden Sie die Seite neu, warnt Sie der Browser.

Sobald die Transkription läuft, können Sie die Seite verlassen. Sie läuft auf dem Server weiter und steht später in der Übersicht. Das gilt nicht für die Schritte eines Pakets: Sie laufen nur, solange die Seite geöffnet bleibt. Öffnen Sie die Transkription im selben Tab erneut, starten die Schritte dann.

> **Große Dateien.** Eine hochgeladene Datei allein erscheint nicht in der Übersicht. Klicken Sie schon während des Uploads auf **Transkribieren wenn bereit** und lassen Sie den Tab geöffnet, bis der Upload fertig ist. Sobald die Transkription läuft, können Sie die Seite verlassen.

## Wenn die Transkription fehlschlägt

Schlägt die Transkription fehl, erscheint **Transkription fehlgeschlagen** mit dem Grund nach **Fehlermeldung:**, zum Beispiel:

- **Die Spracherkennung hat diese Transkription nicht innerhalb des Zeitlimits abgeschlossen.**
- **Die Anfrage an die Spracherkennung ist fehlgeschlagen.**
- **Die Spracherkennung hat für diese Transkription einen Fehler gemeldet.**
- **Der Server wurde neu gestartet, während diese Transkription lief.**

War als Sprache „Automatisch erkennen“ eingestellt und hat die Spracherkennung einen Fehler gemeldet, steht darunter: **Als Sprache war „Automatisch erkennen“ eingestellt. Es kann helfen, die Sprache auszuwählen.**

**Erneut versuchen** führt Sie zu den Einstellungen für dieselbe Datei. Prüfen Sie sie, ändern Sie etwa die Sprache, und klicken Sie auf **Transkribieren**. Die Datei müssen Sie dafür nicht noch einmal hochladen.

Die fehlgeschlagene Transkription bleibt mit dem roten Status „Fehlgeschlagen“ in der Übersicht. Öffnen Sie sie dort, zeigt ihre Seite denselben Hinweis mit dem Grund und **Erneut versuchen**. Von dort aus übernehmen die Einstellungen nicht die des fehlgeschlagenen Versuchs; prüfen Sie vor allem **Sprache für die Transkription** und **Qualität** (bzw. **Modell**). Eine neue Transkription derselben Datei erscheint als eigener Eintrag. Sie gehört zur selben Datei und hat deshalb dieselbe Frist (siehe „Archiv“). Die fehlgeschlagene entfernen Sie mit **Transkription löschen** auf ihrer Seite. Verwendet eine andere Transkription die Datei, bleibt die Datei dabei erhalten.

Schlägt die Transkription wiederholt fehl, schreiben Sie an [{{contact_email}}](mailto:{{contact_email}}).
