# Übersetzung

## Was die Übersetzung erzeugt

Die Übersetzung erzeugt eine zweite Fassung Ihrer Untertitel in einer anderen Sprache. Zu jeder Äußerung gehört eine übersetzte Äußerung an derselben Stelle. Das Sprachmodell soll Zeiten und die Angabe der sprechenden Person unverändert lassen und Äußerungen weder zusammenfassen noch teilen. Stimmt die Anzahl der übersetzten Äußerungen nicht, schlägt die Übersetzung fehl.

Das Original bleibt erhalten. Die Übersetzung erscheint neben **Original** (und **Verfeinert**) als Schaltfläche, zum Beispiel **Übersetzt (EN · aus Original)**. Sie wird mit der Transkription gespeichert, ist beim erneuten Öffnen wieder da und wird zusammen mit ihr gelöscht.

> **Erst speichern.** Die Übersetzung arbeitet mit dem gespeicherten Text. Änderungen im Editor, die Sie noch nicht mit **Änderungen speichern** gesichert haben, sind nicht enthalten.

## Übersetzen

Klicken Sie im Reiter **Untertitel** über der Tabelle auf **Übersetzen**. Die Schaltfläche gibt es, solange noch keine Übersetzung existiert. Der Dialog **Übersetzen nach** öffnet sich.

![Der Dialog „Übersetzen nach“; nummerierte Markierungen heben die Bedienelemente hervor](shots/translate.png)

1. **Übersetzungssprache** wählt die Sprache, in die übersetzt wird.
2. **Quelle** erscheint, wenn es eine Verfeinerung gibt (siehe „Quelle: Original oder Verfeinert“).
3. **Übersetzen** startet die Übersetzung. **Abbrechen** schließt den Dialog.

Während der Übersetzung steht auf der Schaltfläche **Übersetze...**, und die Auswahlfelder und Schaltflächen sind gesperrt. Bei mehr als 50 Äußerungen weist ein Hinweis darauf hin, dass die Übersetzung mehrere Minuten dauern kann. Die Seite wartet auf das Sprachmodell. Bleiben Sie darauf, bis der Dialog sich schließt. Verlassen Sie die Seite trotzdem, läuft die Übersetzung auf dem Server weiter. Sie sehen sie, wenn Sie die Transkription später erneut öffnen. Ein neuer Versuch, bevor sie fertig ist, schlägt fehl. Danach zeigt der Editor die Ansicht **Übersetzt**.

Die Sprache der Aufnahme taugt nicht als Zielsprache. Ist sie bekannt und wählen Sie sie, schlägt die Übersetzung fehl, und der Dialog nennt den Grund auf Englisch, zum Beispiel **The transcript is already in German.**

## Quelle: Original oder Verfeinert

Gibt es eine Verfeinerung, zeigt der Dialog den Umschalter **Quelle** mit **Original** und **Verfeinert**. Voreingestellt ist **Verfeinert**. Ohne Verfeinerung gibt es den Umschalter nicht, und die Übersetzung nutzt das Original. Welche Quelle verwendet wurde, steht auf der Schaltfläche der Übersetzung: **aus Original** oder **aus Verfeinerung**.

## Ansehen, lesen und löschen

Die Ansicht **Übersetzt** ist schreibgeschützt. Die Reiter **SRT**, **VTT**, **JSON** und **TXT** zeigen die Übersetzung, solange **Übersetzt** gewählt ist (siehe „Formatansicht“).

Eine Übersetzung existiert pro Transkription nur einmal. Für eine andere Sprache klicken Sie auf **Übersetzung löschen** und übersetzen dann neu. Das Löschen geschieht nach einer Rückfrage.

## Wenn sich die Quelle ändert

Hat sich der Text der Quelle nach der Übersetzung geändert, erscheint neben **Übersetzung löschen** ein Hinweis in Bernstein: **Quelle hat neueren Inhalt**. Der Hinweis erscheint, sobald Sie die Transkription erneut öffnen. Das passiert zum Beispiel, wenn die Übersetzung aus dem Original entstand und Sie Text darin ändern und speichern. Wurde die Verfeinerung gelöscht, aus der die Übersetzung entstand, steht dort **Quelle nicht mehr verfügbar**. Änderungen an Zeiten oder Namen zählen nicht als neuer Inhalt. Die Übersetzung selbst bleibt unverändert, bis Sie sie erneuern. Klicken Sie dazu auf den Hinweis. Der Dialog **Übersetzen nach** öffnet sich, und eine neue Übersetzung ersetzt die veraltete. Wählen Sie dieselbe Sprache wie zuvor und, sofern der Dialog **Quelle** anbietet, dieselbe Quelle, sagt der Dialog das: **Die veraltete Übersetzung wird ersetzt.**

## Wenn die Übersetzung nicht klappt

Der Dialog zeigt dann den Grund, den der Server auf Englisch nennt, zum Beispiel **Translation failed**. Ohne Grund zeigt er **Übersetzung fehlgeschlagen. Bitte versuchen Sie es erneut.** transkribierBAR wiederholt einzelne Abschnitte vorher selbst. Gelingt auch das nicht für einen Abschnitt, entsteht keine Übersetzung. Teilweise übersetzte Fassungen gibt es nicht. Ein neuer Versuch kann gelingen.

## In einem Paket

Enthält ein Paket eine Zielsprache, übersetzt der Browser nach der Transkription, nach der Verfeinerung und nach der Analyse automatisch. Gibt es dann eine Verfeinerung, nutzt die Übersetzung diese, sonst das Original. Bleiben Sie auf der Seite, bis alle Schritte fertig sind.
