"""Open-Meteo forecast + the warmth-band model from taxonomy.md.

No API key, no account, no rate limit for personal use. Stdlib only.
"""

import json
import sys
import urllib.parse
import urllib.request

# Aly's location. Override with --lat/--lon or edit preferences.json.
DEFAULT_LAT, DEFAULT_LON = 40.7128, -74.0060

# (max_high_F, low_target, high_target) — from taxonomy.md Part 3.
BANDS = [
    (25, 20, 26),
    (35, 16, 20),
    (45, 13, 16),
    (55, 10, 13),
    (65, 7, 10),
    (75, 5, 7),
    (85, 3, 5),
    (999, 2, 4),
]

# WMO weather codes -> plain language.
WMO = {
    0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle",
    55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers",
    81: "rain showers", 82: "heavy showers", 95: "thunderstorm",
}


def fetch(lat=DEFAULT_LAT, lon=DEFAULT_LON, days=1):
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                 "wind_speed_10m_max,weather_code",
        "temperature_unit": "fahrenheit",
        "timezone": "auto",
        "forecast_days": days,
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=15) as resp:
        return json.load(resp)


def describe(raw, index=0):
    """One day of forecast, plus everything the outfit engine needs to decide."""
    d = raw["daily"]
    high = d["temperature_2m_max"][index]
    low = d["temperature_2m_min"][index]
    precip = d["precipitation_probability_max"][index]
    wind = d["wind_speed_10m_max"][index]
    code = d["weather_code"][index]

    target_low, target_high = next((lo, hi) for cap, lo, hi in BANDS if high < cap)

    swing = high - low
    modifiers = []
    if wind > 20:
        target_low += 1
        target_high += 1
        modifiers.append(f"windy ({wind:.0f} km/h) — counts as one layer colder")
    if precip > 40:
        modifiers.append(f"{precip:.0f}% chance of rain — needs a water-ok outer layer, no suede")
    if swing > 20:
        modifiers.append(f"{swing:.0f}°F swing — needs at least one removable layer")

    return {
        "date": d["time"][index],
        "high_f": high,
        "low_f": low,
        "precip_pct": precip,
        "wind_kmh": wind,
        "conditions": WMO.get(code, "unclear"),
        "warmth_target": [target_low, target_high],
        "modifiers": modifiers,
    }


def main():
    args = sys.argv[1:]
    lat = float(args[args.index("--lat") + 1]) if "--lat" in args else DEFAULT_LAT
    lon = float(args[args.index("--lon") + 1]) if "--lon" in args else DEFAULT_LON
    try:
        raw = fetch(lat, lon)
    except Exception as exc:
        # Per CHECKS.md: never guess a temperature. Fail loudly instead.
        raise SystemExit(f"Weather fetch failed ({exc}). Not guessing — no outfit today.")
    print(json.dumps(describe(raw), indent=2))


if __name__ == "__main__":
    main()
