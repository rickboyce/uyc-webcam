import { USER_LOCALE, fetchJson, nearestHour, setTimestamp } from "./shared.js";

const WEATHER_PATH = "/var/weather.json";
const REFRESH_MS = 300_000;
const WEATHER_DAY_CLASS = "card weather-day";
const WEATHER_HOUR_CLASS = "card weather-hour";
const WEATHER_ICON_BASE = "https://cdn.meteocons.com/3.0.0-next.10/svg";
const WEATHER_ICON_MONOCHROME_SET = "monochrome";
const WEATHER_ICON_COLOUR_SET = "fill";
const RAIN_RISK_HOURS = 3;
const REQUIRED_HOURLY_FIELDS = [
    "time",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "wind_direction_10m"
];

function weatherDescription(code) {
    const descriptions = {
        0: "Clear",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Freezing fog",
        51: "Light drizzle",
        53: "Drizzle",
        55: "Heavy drizzle",
        56: "Freezing drizzle",
        57: "Heavy freezing drizzle",
        61: "Light rain",
        63: "Rain",
        65: "Heavy rain",
        66: "Freezing rain",
        67: "Heavy freezing rain",
        71: "Light snow",
        73: "Snow",
        75: "Heavy snow",
        77: "Snow grains",
        80: "Light showers",
        81: "Showers",
        82: "Heavy showers",
        85: "Snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with hail",
        99: "Thunderstorm with heavy hail"
    };

    return descriptions[code] || "Unknown";
}

function isDaytime(value) {
    return value === true || value === 1 || value === "1";
}

function weatherIconName(code, isDay = true) {
    const dayNightIcons = {
        0: isDay ? "clear-day" : "clear-night",
        1: isDay ? "partly-cloudy-day" : "partly-cloudy-night",
        2: isDay ? "partly-cloudy-day" : "partly-cloudy-night",
        45: isDay ? "fog-day" : "fog-night",
        48: isDay ? "fog-day" : "fog-night",
        80: isDay ? "partly-cloudy-day-rain" : "partly-cloudy-night-rain",
        96: isDay ? "thunderstorms-day-rain" : "thunderstorms-night-rain"
    };

    const icons = {
        3: "overcast",
        51: "drizzle",
        53: "drizzle",
        55: "drizzle",
        56: "sleet",
        57: "sleet",
        61: "rain",
        63: "rain",
        65: "rain",
        66: "sleet",
        67: "sleet",
        71: "snow",
        73: "snow",
        75: "snow",
        77: "snowflake",
        81: "rain",
        82: "extreme-rain",
        85: "snow",
        86: "extreme-snow",
        95: "thunderstorms-rain",
        99: "thunderstorms-rain"
    };

    return dayNightIcons[code] || icons[code] || "not-available";
}

function meteoconMarkup(iconName, description, set = WEATHER_ICON_COLOUR_SET) {
    return `<img class="weather-condition-icon" src="${WEATHER_ICON_BASE}/${set}/${iconName}.svg" alt="${description}" aria-hidden="true" title="${description}">`;
}

function windIconMarkup(iconName, description, beaufortForce) {
    return `${meteoconMarkup(iconName, description)}<span class="wind-force-badge" aria-hidden="true">F${beaufortForce}</span>`;
}

function weatherIconMarkup(code, description, isDay = true) {
    return meteoconMarkup(weatherIconName(code, isDay), description);
}

function hourlyWeatherIconMarkup(code, description) {
    return `<img class="weather-hour-icon" src="${WEATHER_ICON_BASE}/${WEATHER_ICON_MONOCHROME_SET}/${weatherIconName(code)}.svg" alt="" aria-hidden="true" title="${description}">`;
}

function beaufortScaleFromMph(mph) {
    if (mph < 1) return 0;
    if (mph < 4) return 1;
    if (mph < 8) return 2;
    if (mph < 13) return 3;
    if (mph < 19) return 4;
    if (mph < 25) return 5;
    if (mph < 32) return 6;
    if (mph < 39) return 7;
    if (mph < 47) return 8;
    if (mph < 55) return 9;
    if (mph < 64) return 10;
    if (mph < 73) return 11;
    return 12;
}

function windsockIconName(mph) {
    // Keep this deliberately simple for a quick visual sailing read:
    // calm: Beaufort 0-1, weak: Beaufort 2-3, moderate: Beaufort 4-5, full: Beaufort 6+
    if (mph < 4) {
        return "windsock-calm";
    }

    if (mph < 13) {
        return "windsock-weak";
    }

    if (mph < 25) {
        return "windsock-moderate";
    }

    return "windsock";
}

function shortTermRainRisk(hourly, now = new Date()) {
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.precipitation_probability)) {
        return null;
    }

    const nextHourIndexes = hourly.time
        .map((timeText, index) => ({
            hourDate: new Date(timeText),
            index
        }))
        .filter(({ hourDate }) => !Number.isNaN(hourDate.getTime()) && hourDate > now)
        .slice(0, RAIN_RISK_HOURS)
        .map(({ index }) => index);

    if (nextHourIndexes.length < RAIN_RISK_HOURS) {
        return null;
    }

    const probabilities = nextHourIndexes.map(index => Number(hourly.precipitation_probability[index]));

    if (probabilities.some(probability => !Number.isFinite(probability))) {
        throw new Error("Hourly precipitation probability unavailable for next 3 hours");
    }

    return Math.round(Math.max(...probabilities));
}

function temperatureIconName(celsius) {
    if (celsius < 16) {
        return "thermometer-colder";
    }

    if (celsius >= 22) {
        return "thermometer-warmer";
    }

    return "thermometer";
}

function compassDirection(degrees) {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(degrees / 45) % 8;
    return directions[index];
}

function windDirectionMarkup(direction, degrees) {
    const rotation = (degrees + 90) % 360;

    return `<span class="wind-direction"><span>${direction}</span><svg class="wind-arrow" style="--wind-rotation: ${rotation}deg" viewBox="0 0 24 24" role="img" aria-label="Wind from ${direction}"><circle cx="12" cy="12" r="11"></circle><path d="M6 12h10M12 7l5 5-5 5"></path></svg></span>`;
}

function renderHourlyWind(hours, data) {
    const hourly = data.hourly;
    hours.innerHTML = "";

    const missingFields = REQUIRED_HOURLY_FIELDS.filter(field => !hourly || !hourly[field]);

    if (missingFields.length > 0) {
        hours.innerHTML = `<div class="${WEATHER_HOUR_CLASS}">Hourly wind unavailable</div>`;
        return;
    }

    const nowHour = nearestHour(new Date());
    const startHour = new Date(nowHour);
    startHour.setHours(startHour.getHours() - 1);

    const endHour = new Date(nowHour);
    endHour.setHours(endHour.getHours() + 6);

    hourly.time.forEach((timeText, index) => {
        const hourDate = new Date(timeText);

        if (hourDate < startHour || hourDate > endHour) {
            return;
        }

        const speedMph = Math.round(hourly.wind_speed_10m[index]);
        const gustMph = Math.round(hourly.wind_gusts_10m[index]);
        const direction = compassDirection(hourly.wind_direction_10m[index]);
        const description = weatherDescription(hourly.weather_code[index]);
        const isNow = hourDate.getTime() === nowHour.getTime();
        const label = hourDate.toLocaleTimeString(USER_LOCALE, {
            hour: "2-digit",
            minute: "2-digit"
        });

        const card = document.createElement("div");
        card.className = isNow ? `${WEATHER_HOUR_CLASS} is-now` : WEATHER_HOUR_CLASS;
        card.innerHTML = `
            <div class="weather-hour-top">
                <span class="weather-hour-meta">${isNow ? "Now" : label} - ${windDirectionMarkup(direction, hourly.wind_direction_10m[index])}</span>
                ${hourlyWeatherIconMarkup(hourly.weather_code[index], description)}
            </div>
            <div class="weather-hour-bottom"><span class="wind-speed">${speedMph}<span class="wind-unit"> mph</span></span><span class="wind-gust">gusts ${gustMph}</span></div>
        `;

        hours.appendChild(card);
    });

    if (hours.children.length === 0) {
        hours.innerHTML = `<div class="${WEATHER_HOUR_CLASS}">Hourly wind unavailable</div>`;
    }
}

function weatherDayCardMarkup(daily, index) {
    const date = new Date(`${daily.time[index]}T12:00:00`);
    const weekday = date.toLocaleDateString(USER_LOCALE, { weekday: "short" });
    const dayNumber = date.toLocaleDateString(USER_LOCALE, { day: "numeric" });
    const month = date.toLocaleDateString(USER_LOCALE, { month: "short" });
    const maxTemp = Math.round(daily.temperature_2m_max[index]);
    const minTemp = Math.round(daily.temperature_2m_min[index]);
    const rain = daily.precipitation_probability_max[index];
    const maxWindMph = Math.round(daily.wind_speed_10m_max[index]);
    const maxGustMph = Math.round(daily.wind_gusts_10m_max[index]);
    const dominantWindDegrees = daily.wind_direction_10m_dominant ? daily.wind_direction_10m_dominant[index] : null;
    const dominantWindDirection = dominantWindDegrees === null ? null : compassDirection(dominantWindDegrees);
    const desc = weatherDescription(daily.weather_code[index]);

    return `
        <div class="weather-day-head">
            <div class="date-badge weather-day-date" aria-hidden="true">
                <span class="date-badge-part weather-day-date-weekday">${weekday}</span>
                <span class="date-badge-number weather-day-date-number">${dayNumber}</span>
                <span class="date-badge-part weather-day-date-month">${month}</span>
            </div>
            ${weatherIconMarkup(daily.weather_code[index], desc)}
            <div class="weather-day-summary">
                <div class="weather-day-title">${desc}</div>
                <div class="weather-temp-range" aria-label="Temperature range ${minTemp} to ${maxTemp} degrees Celsius">
                    <span class="weather-temp-low">${minTemp}&deg;</span>
                    <span class="weather-temp-separator">\u2013</span>
                    <span class="weather-temp-high">${maxTemp}&deg;C</span>
                </div>
            </div>
        </div>
        <div class="weather-day-stats">
            <div class="weather-stat">
                <span class="label weather-stat-label">Rain</span>
                <span class="weather-stat-value">${rain}%</span>
            </div>
            <div class="weather-stat">
                <span class="label weather-stat-label">Wind</span>
                <span class="weather-stat-value">${maxWindMph} mph</span>
            </div>
            <div class="weather-stat weather-stat-direction">
                <span class="label weather-stat-label">From</span>
                <span class="weather-stat-value">${dominantWindDirection ? windDirectionMarkup(dominantWindDirection, dominantWindDegrees) : "\u2014"}</span>
            </div>
            <div class="weather-stat">
                <span class="label weather-stat-label">Gusts</span>
                <span class="weather-stat-value">${maxGustMph} mph</span>
            </div>
        </div>
    `;
}

function renderForecastDays(days, daily) {
    days.innerHTML = "";

    for (let index = 1; index < daily.time.length && index <= 3; index++) {
        const card = document.createElement("div");
        card.className = WEATHER_DAY_CLASS;
        card.innerHTML = weatherDayCardMarkup(daily, index);
        days.appendChild(card);
    }
}

function renderCurrentWeather(elements, data) {
    const current = data.current;
    const hourly = data.hourly;
    const temp = Math.round(current.temperature_2m);
    const feels = Math.round(current.apparent_temperature);
    const windMph = Math.round(current.wind_speed_10m);
    const gustMph = Math.round(current.wind_gusts_10m);
    const windDir = compassDirection(current.wind_direction_10m);
    const rainRisk = shortTermRainRisk(hourly);
    const currentWeatherDescription = weatherDescription(current.weather_code);
    const currentIsDay = current.is_day === undefined ? true : isDaytime(current.is_day);
    const beaufortForce = beaufortScaleFromMph(windMph);

    elements.conditionHeading.textContent = ` \u2013 ${currentWeatherDescription}`;
    elements.now.innerHTML =
        `${meteoconMarkup(temperatureIconName(temp), `Temperature ${temp} degrees Celsius`)}<span class="current-primary">${temp}&deg;C</span><span class="current-detail">Feels like ${feels}&deg;C</span>`;
    elements.wind.innerHTML =
        `${windIconMarkup(windsockIconName(windMph), `Wind ${windMph} mph, Beaufort force ${beaufortForce}`, beaufortForce)}<span class="current-primary">${windDirectionMarkup(windDir, current.wind_direction_10m)} ${windMph}<span class="wind-unit"> mph</span></span><span class="current-detail">Gusting ${gustMph} mph</span>`;
    elements.rain.innerHTML =
        `${weatherIconMarkup(current.weather_code, currentWeatherDescription, currentIsDay)}<span class="current-primary">${rainRisk === null ? "\u2014" : `${rainRisk}%`}</span><span class="current-detail">next ${RAIN_RISK_HOURS} hours</span>`;
}

async function refreshWeather(elements) {
    try {
        const data = await fetchJson(WEATHER_PATH);
        renderCurrentWeather(elements, data);
        renderHourlyWind(elements.hours, data);
        renderForecastDays(elements.days, data.daily);
        setTimestamp(elements.timestamp, data.current.time);
    } catch {
        elements.conditionHeading.textContent = "";
        elements.now.textContent = "Unavailable";
        elements.wind.textContent = "Unavailable";
        elements.rain.textContent = "Unavailable";
        elements.hours.innerHTML = "";
        elements.days.innerHTML = "";
    }
}

export function setupWeather() {
    const elements = {
        conditionHeading: document.getElementById("weather-condition-heading"),
        now: document.getElementById("weather-now"),
        wind: document.getElementById("weather-wind"),
        rain: document.getElementById("weather-rain"),
        hours: document.getElementById("weather-hours"),
        days: document.getElementById("weather-days"),
        timestamp: document.getElementById("weather-timestamp")
    };

    refreshWeather(elements);
    setInterval(() => refreshWeather(elements), REFRESH_MS);
}
