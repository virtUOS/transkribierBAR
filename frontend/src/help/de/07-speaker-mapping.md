# Sprechende benennen

## Bereich öffnen

Öffnen Sie im Reiter **Untertitel** den Bereich **Namen der Sprechenden**: mit der gleichnamigen Schaltfläche über der Tabelle oder mit dem Personensymbol in der Spalte **Sprechende Person** einer Zeile.

![Der Bereich „Namen der Sprechenden“ über der Tabelle des Editors; nummerierte Markierungen heben die Bedienelemente hervor](shots/speakers.png)

1. **Namen der Sprechenden** öffnet den Bereich. Ein weiterer Klick schließt ihn wieder.
2. Das Feld für einen neuen Namen (**Neuer Name (leer lassen zum Beibehalten)**), rechts neben dem Namen, der gerade angezeigt wird (siehe „Namen vergeben“).
3. **Anwenden** speichert die Namen (siehe „Wie die Namen gespeichert werden“).
4. Die Spalte **Sprechende Person** einer Zeile. Ihr Personensymbol (**Diese Person in allen Äußerungen umbenennen**) öffnet den Bereich und setzt den Cursor gleich in das Feld dieser Person. Ihr Stiftsymbol ändert nur diese Zeile (siehe „Einzelne Zeile ändern“).

In der Ansicht **Verfeinert** und in der Ansicht **Übersetzt** fehlt das Personensymbol, die Schaltfläche funktioniert aber.

Hat die Aufnahme keine erkannten Sprechenden, zeigt der Bereich **Keine Sprechenden erkannt.** Ob Sprechende erkannt werden, legen Sie vor der Transkription fest (siehe „Transkriptionseinstellungen“).

## Namen vergeben

Der Bereich listet jede sprechende Person mit dem Namen auf, der gerade angezeigt wird. Ohne eigenen Namen ist das die gespeicherte Kennung, zum Beispiel `SPEAKER_00`. Tragen Sie rechts davon im Feld einen neuen Namen ein und klicken Sie auf **Anwenden**. Felder, die Sie leer lassen (**Neuer Name (leer lassen zum Beibehalten)**), behalten ihren Namen. Leerzeichen am Anfang und Ende des Namens entfernt transkribierBAR. **Abbrechen** schließt den Bereich ohne Änderung.

Der neue Name steht danach in der Tabelle, bei Videos in der Untertitelspur des Players und in den Reitern **SRT**, **VTT**, **JSON** und **TXT** samt deren Downloads. Das gilt für das Original, für **Verfeinert** und für eine Übersetzung, gleich aus welcher der beiden Fassungen sie entstand. Haben Sie schon Namen vergeben, schlägt das Feld sie zur Auswahl vor.

## Personen zusammenführen

Geben Sie zwei Sprechenden denselben Namen, behandelt transkribierBAR sie als eine Person. Der Bereich zeigt sie dann in einer Zeile mit einem Zusatz wie **2 zusammengeführt**, und ihre Punkte haben dieselbe Farbe. Das hilft, wenn die Erkennung eine Person als zwei erkannt hat.

## Einzelne Zeile ändern

Wurde eine Äußerung der falschen Person zugeordnet, klicken Sie in der Spalte **Sprechende Person** der Zeile auf das Stiftsymbol (**Namen der sprechenden Person bearbeiten**). Schreiben Sie den Namen der richtigen Person und bestätigen Sie mit der Eingabetaste. Schreiben Sie ihn genau so, wie er schon angezeigt wird, dann gehört die Zeile zu dieser Person. Das Stiftsymbol gibt es nur bei Zeilen mit einer sprechenden Person und nicht in den Ansichten **Verfeinert** und **Übersetzt**.

Diese Änderung gilt nur für die eine Zeile und wirkt wie jede Textänderung erst nach **Änderungen speichern** dauerhaft (siehe „Untertitel-Editor“).

## Wie die Namen gespeichert werden

**Anwenden** speichert die Namen sofort auf dem Server, unabhängig von **Änderungen speichern**. Sie gelten für genau diese Transkription. Wenn Sie sie später wieder öffnen, sind dieselben Namen da. Im Transkript selbst bleibt die ursprüngliche Kennung gespeichert, die Namen kommen beim Anzeigen und in den Formaten dazu.
