# Plateo Print Agent

Lets Plateo print kitchen tickets and bills **straight to the thermal printer**,
instead of through the browser's print dialog.

Through the browser, the Windows printer driver decides the paper: its page
length, margins and orientation. That is how bills came out sideways, or as a
few lines of text in the middle of a metre of blank roll. Sent directly, the
printer gets its own ESC/POS commands. The receipt is exactly as long as its
lines, printed in the printer's own font, and then cut.

## Setting up a till

You need the till's Windows PC, and the thermal printer plugged into the same
network (LAN cable or Wi-Fi), switched on.

1. **Find the printer's IP address.** Print the printer's network status sheet:
   on Epson TM printers with a network port, hold the small button on the back of
   the network interface for about three seconds. The sheet shows the IP address,
   for example `192.168.1.50`.
2. **Give the printer a fixed address.** In the restaurant's router, reserve that
   IP for the printer (often called "DHCP reservation" or "static lease"). If the
   router gives the printer a new address after a power cut, the agent will be
   pointing at the old one, and printing falls back to the browser until it's
   updated.
3. **Copy `plateo-print-agent.exe` to the till**, somewhere it will stay, such as
   `C:\Plateo\`, and double-click it. Windows may say "Windows protected your
   PC": choose **More info → Run anyway**. From then on it starts by itself
   whenever Windows starts.
4. **The settings page opens** (`http://127.0.0.1:9123`). Enter the printer's IP
   as the **Bill printer**. If the kitchen has its own printer, enter that as the
   **Kitchen (KOT) printer**; otherwise leave it empty. Press **Save**, then
   **Test bill printer**. A short test slip should print.
5. **In Plateo**, open **KOT & Printing** and press **Connect this till**. Chrome
   asks once whether Plateo may talk to apps on this device. Choose **Allow**.
6. Press **Print a test** on the kitchen ticket and the bill.

Do this once on each till that prints.

## When something goes wrong

Plateo never loses a print. If the agent isn't running, has no printer set, or
can't reach the printer, it prints through the browser exactly as it did before,
so you can always print something.

| What you see | What to do |
| --- | --- |
| The browser's print dialog appears again | The agent has stopped, or can't reach the printer. Check the small Plateo window is still open, and that the printer is on. Open `http://127.0.0.1:9123` and press **Test**. |
| "No printer answered at …" | Wrong IP, printer off, or it has a new address. Print its status sheet again and update the IP. |
| Nothing at all, no dialog | Plateo shows an error when the printer stopped part-way through a job. It won't reprint automatically, so you never get two bills. Check the printer, then print again. |

## Security

- It listens on `127.0.0.1` only, so no other computer on the network can use it.
- It only accepts print jobs from Plateo's own web address. Another website open
  in another tab can't feed the printer.
- Printer addresses can only be changed from its own settings page on that till.
- Printer addresses stay on the till and are never sent to Plateo's servers.

## Removing it

Run `plateo-print-agent.exe --uninstall` to stop it starting with Windows, then
delete the file.

## For developers

```
node agent.js              # run from source (Node 20+)
node build-exe.cjs         # build dist/plateo-print-agent.exe (not committed)
```

Settings live in `%APPDATA%\PlateoPrintAgent\config.json`. Environment overrides:
`PLATEO_AGENT_PORT`, `PLATEO_AGENT_CONFIG`, `PLATEO_ALLOWED_ORIGINS`
(comma-separated, added to `https://app.plateoai.in`), and
`PLATEO_AGENT_NO_AUTOSTART=1` to run the .exe without registering it to start
with Windows.
