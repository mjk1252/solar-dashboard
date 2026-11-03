# Home Solar Dashboard

A single-page dashboard for Sunsynk inverter systems. Shows solar, battery and grid usage, what you paid, what you saved, peak sun times and battery level.

**Two ways to load data**

- **Excel export:** drop in one or more inverter reports downloaded from Sunsynk Connect. The file is read in your browser and never uploaded.
- **Live:** click *Connect Sunsynk* and sign in with your Sunsynk Connect account. Your login goes straight from your browser to Sunsynk (api.sunsynk.net). The password is never stored. Refreshes every 5 minutes.

Set your electricity price per kWh under *Rates & costs*.

Live mode uses Sunsynk's unofficial web API and may stop working if Sunsynk changes it. The Excel upload keeps working regardless.
