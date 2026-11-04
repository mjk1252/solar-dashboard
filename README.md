# Home Solar Dashboard

A single-page dashboard for Sunsynk inverter systems. Shows solar, battery and grid usage, what you paid, what you saved, peak sun times and battery level.

**Two ways to load data**

- **Excel export:** drop in one or more inverter reports downloaded from Sunsynk Connect. The file is read in your browser and never uploaded.
- **Live:** click *Connect Sunsynk* and sign in with your Sunsynk Connect account. Your login goes straight from your browser to Sunsynk (api.sunsynk.net). The password is never stored. Refreshes every 5 minutes.

Set your electricity price per kWh under *Rates & costs*.

Live mode uses Sunsynk's unofficial web API and may stop working if Sunsynk changes it. The Excel upload keeps working regardless.

## Siri, Shortcuts and a home-screen widget (iPhone)

`siri/house-power.js` is a script for the free [Scriptable](https://scriptable.app) app. It reads the same live data and:

- answers "Hey Siri, House Power" with solar, battery, grid and house power, plus today's solar and grid kWh
- can run on a schedule via a Shortcuts automation (as a notification)
- works as a home-screen widget

Setup: create a new script in Scriptable named **House Power**, paste in the file, and run it once to enter your Sunsynk Connect login (saved in the iPhone Keychain, not in the script). Then add a shortcut with Scriptable's **Run Script** action followed by **Speak Text**. Pass `reset` as the shortcut parameter to clear the saved login.
