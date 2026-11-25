# Soft Steps (mobile)

The iPhone and Android version of Soft Steps. It connects to the wearable over Bluetooth, shows your knee angle and step impacts live as you hike, and saves your hikes to the same account as the web app.

The web app we built at the hackathon worked, but it ran on a laptop. The mobile app is so Soft Steps can come on a real hike.

## What's new compared to the web app

- **Works on your phone.** No laptop needed on the trail.
- **Works offline.** Hikes save on the phone and upload automatically when you're back in signal.
- **Handles Bluetooth dropouts.** If the sensor disconnects, the hike keeps going and the app reconnects on its own. The web app ended the hike instead.
- **Recovers unfinished hikes.** If the app closes mid-hike, you can pick up where you left off.
- **More accurate calibration.** The straight-leg position is measured over a few seconds instead of a single reading, so the knee angle starts out more accurate. 

Everything else works the same as the web app: knee angle, impact and step tracking, hike history and charts, and the AI assistant. Hikes recorded on either one show up in both.

## How a hike works

1. Connect to the sensor.
2. Stand with your leg straight and press **Start**. The app calibrates your straight leg as 180°.
3. Hike. The app shows your knee angle, impacts and step count live.
4. Press **Finish** to see the hike's stats and charts.

## Built with

Expo and React Native (TypeScript), Bluetooth Low Energy, SQLite for storing hikes on the phone, and Supabase for accounts and syncing.
