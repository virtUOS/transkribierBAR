# Untertitel-Editor

## Aufbau

Der Editor steht im Reiter **Untertitel** der Detailansicht. Jede Zeile der Tabelle ist eine Äußerung mit den Spalten **#**, **Start**, **Ende**, **Sprechende Person** und **Text**. Auf schmalen Bildschirmen fehlen die Spaltenüberschriften und die Spalte **#**.

![Die Detailansicht mit Player, Suche, Schaltflächen für die Fassungen und den ersten Zeilen des Editors; nummerierte Markierungen heben die Bedienelemente hervor](shots/editor.png)

1. Der Player (siehe „Abspielen und Mitlaufen“).
2. Das Suchfeld **Untertitel durchsuchen...** mit den Schaltflächen **Text** und **Sprechende** (siehe „Suchen“).
3. **Original**, **Verfeinert** und **Übersetzt** wechseln zwischen dem Original und seiner verfeinerten und übersetzten Fassung (siehe „Verfeinerte und übersetzte Ansicht“).
4. Eine Zeile ist eine Äußerung. Ihre Stiftsymbole bearbeiten die Zeiten, die sprechende Person und den Text (siehe die folgenden Abschnitte).
5. Die **Sprechende Person** der Zeile. Der farbige Punkt zeigt, wer spricht; gleiche Namen haben gleiche Farben.

## Text bearbeiten

Klicken Sie auf das Stiftsymbol hinter dem Text und schreiben Sie los. Ein Klick außerhalb des Felds übernimmt die Änderung. Mit **Tab** übernehmen Sie sie und springen zum Text der nächsten Zeile, mit **Shift+Tab** zur vorherigen. Dabei springt der Player an den Anfang dieser Zeile. **Esc** beendet die Bearbeitung; die Änderung bleibt erhalten.

Auf größeren Bildschirmen listet die Aufklappliste **Tastenkürzel** über der Tabelle diese drei Tasten auf.

Ihre Änderungen gelten zunächst nur in Ihrem Browser, bis Sie sie speichern (siehe „Speichern“).

## Zeiten bearbeiten

Mit dem Stiftsymbol neben **Start** oder **Ende** ändern Sie die Zeit. Die Tabelle zeigt ganze Sekunden, das Feld zeigt die Zeit mit Millisekunden, zum Beispiel `00:01:30.500`. Sie können auch nur Minuten und Sekunden (`01:30`) oder nur Sekunden (`90`) eingeben. Bruchteile einer Sekunde stehen nach einem Punkt oder einem Komma, zum Beispiel `12,5`. Mit der Eingabetaste oder einem Klick außerhalb übernehmen Sie die Zeit. Ist die Zeit unverändert oder keine gültige Zeit, bleibt die Zeile, wie sie war.

Überschneidet die neue Zeit benachbarte Zeilen, passt der Editor diese an: Ein neuer Start verkürzt das Ende der vorherigen Zeilen, ein neues Ende verschiebt den Start der folgenden. Vorher nennt eine Rückfrage die Zahl der betroffenen Zeilen. Wenn Sie sie abbrechen, bleibt alles unverändert. Liegt der neue Start nach dem Ende der Zeile, rückt auch das Ende nach. Entsprechend wird auch der Start vorgezogen, wenn das neue Ende davor liegt.

## Sprechende Person einer Zeile

In der Spalte **Sprechende Person** ändert das Stiftsymbol den Namen nur in dieser Zeile, das Personensymbol benennt die Person in allen Zeilen um. Beides steht im Abschnitt „Sprechende benennen“.

## Zeilen einfügen, zusammenführen, löschen

Im Textfeld der Zeile stehen weitere Symbole:

- **Mit nächstem Abschnitt zusammenführen** verbindet den Text mit dem der nächsten Zeile und übernimmt deren Ende. Bei der letzten Zeile fehlt das Symbol.
- **Neue Zeile nach dieser einfügen** legt darunter eine leere Zeile mit derselben sprechenden Person an. Sie beginnt am Ende der aktuellen Zeile und endet am Start der nächsten, bei der letzten Zeile eine Sekunde später. Auf größeren Bildschirmen steht dieses Symbol stattdessen in der Spalte **#**.
- **Diese Zeile löschen** entfernt die Zeile, nachdem Sie die Rückfrage bestätigt haben.

## Suchen

Über der Tabelle durchsucht das Feld **Untertitel durchsuchen...** die Zeilen, ohne Groß- und Kleinschreibung zu beachten. Die Schaltflächen **Text** und **Sprechende** bestimmen, wo gesucht wird. Anfangs sind beide aktiv. Klicken Sie auf eine, bleibt nur die andere aktiv. Klicken Sie auf die aktive, sind wieder beide aktiv.

Treffer sind hervorgehoben. Die Zeilen davor und danach bleiben als abgeblendeter Kontext sichtbar. Ausgeblendete Zeilen dazwischen fasst jeweils eine Trennzeile zusammen, etwa **3 Segmente ausgeblendet**. Neben dem Feld steht, wie viele Segmente passen, zum Beispiel **2 von 40 Segmenten**. Ohne Treffer erscheint **Keine passenden Segmente**. Mit **Esc** im Suchfeld oder dem Kreuz im Feld löschen Sie die Suche.

## Abspielen und Mitlaufen

Ein Klick auf **Start**, **Sprechende Person** oder **Text** einer Zeile springt im Player an den Anfang der Äußerung, ein Klick auf **Ende** an deren Ende. Ist der Player angehalten, beginnt er zu spielen. Währenddessen ist die aktuelle Zeile hervorgehoben und die Tabelle läuft mit. Das Mitlaufen ruht, solange eine Suche aktiv ist.

Unter dem Player lädt **Aufnahme herunterladen** die Aufnahme herunter. Bei Videos blendet **Player minimieren** das Bild aus und **Video anzeigen** wieder ein. Bei Videos enthält der Player außerdem, solange er nicht minimiert ist, eine Untertitelspur mit dem Originaltext und den Namen der Sprechenden, auch mit ungespeicherten Änderungen. Sie ist anfangs ausgeschaltet.

## Speichern

Sobald Sie etwas geändert haben, erscheinen über der Tabelle die Schaltflächen **Änderungen speichern** und **Original wiederherstellen**. Speichern ersetzt die bisher gespeicherte Fassung auf dem Server. **Original wiederherstellen** verwirft nach einer Rückfrage alle Änderungen seit dem letzten Speichern und lädt die gespeicherte Fassung neu. Eine frühere Fassung hebt transkribierBAR nach dem Speichern nicht auf.

Wechseln Sie zu einem Format-Reiter wie **SRT**, bleiben Ihre Änderungen erhalten, und das Format zeigt sie bereits.

> **Speichern Sie, bevor Sie gehen.** Verlassen Sie die Detailansicht mit ungespeicherten Änderungen, fragt transkribierBAR zuerst nach. Auch beim Schließen oder Neuladen des Browser-Tabs erscheint eine Warnung des Browsers. Wenn Sie bestätigen, bleiben die ungespeicherten Änderungen nur so lange in diesem Tab, bis Sie eine andere Transkription öffnen, einen neuen Upload oder eine neue Aufnahme beginnen oder den Tab neu laden oder schließen. Bis dahin bringt Sie **Vorwärts** im Browser zu ihnen zurück. Speichern Sie zuerst.

## Verfeinerte und übersetzte Ansicht

Sind die KI-Funktionen auf diesem Server eingerichtet, bietet der Editor über der Tabelle die Schaltflächen **Mit LLM verfeinern** und **Übersetzen** an, solange es noch keine Verfeinerung beziehungsweise Übersetzung gibt. Eine Verfeinerung und eine Übersetzung erscheinen neben dem Original. Mit den Schaltflächen **Original**, **Verfeinert** und **Übersetzt** wechseln Sie zwischen ihnen. Die Ansicht **Verfeinert** und die Ansicht **Übersetzt** sind schreibgeschützt: Die Symbole zum Bearbeiten fehlen dort, Änderungen gelten nur im Original. Mit **Verfeinerung löschen** und **Übersetzung löschen** entfernen Sie die jeweilige Fassung nach einer Rückfrage.

In der Ansicht **Verfeinert** nennt **Zusammenfassung der Änderungen**, was das Sprachmodell geändert hat. Geänderte Zeilen haben auf jeder Bildschirmgröße die Schaltfläche **Vergleichen** neben dem Text. Sie zeigt Original und verfeinerten Text nebeneinander unter der Zeile; ein erneuter Klick schließt den Vergleich. Auf größeren Bildschirmen tragen geänderte Zeilen außerdem einen Punkt neben der Zeilennummer. Wie beide Funktionen arbeiten, steht in den Abschnitten „Verfeinerung“ und „Übersetzung“.
