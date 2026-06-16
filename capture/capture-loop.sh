#!/bin/sh
set -eu

: "${RTSP_URL:?RTSP_URL environment variable is required}"

CAPTURE_INTERVAL="${CAPTURE_INTERVAL:-60}"

OUTPUT_DIR="${OUTPUT_DIR:-/data}"
TMP_FILE="${OUTPUT_DIR}/camera-working.jpg"
OUTPUT_FILE="${OUTPUT_DIR}/latest.jpg"

WEATHER_ENABLED="${WEATHER_ENABLED:-true}"
WEATHER_INTERVAL="${WEATHER_INTERVAL:-900}"
WEATHER_FILE="${OUTPUT_DIR}/weather.json"
WEATHER_TMP_FILE="${OUTPUT_DIR}/weather-working.json"

: "${LAT:?LAT environment variable is required}"
: "${LON:?LON environment variable is required}"

WEATHER_URL="${WEATHER_URL:-https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&timezone=Europe%2FLondon&forecast_days=3&wind_speed_unit=mph}"

R2_UPLOAD_ENABLED="${R2_UPLOAD_ENABLED:-true}"
R2_REMOTE_NAME="${R2_REMOTE_NAME:-r2}"

# Defaults for the rclone remote named "r2".
# These must be exported so the rclone child process can see them.
export RCLONE_CONFIG_R2_TYPE="${RCLONE_CONFIG_R2_TYPE:-s3}"
export RCLONE_CONFIG_R2_PROVIDER="${RCLONE_CONFIG_R2_PROVIDER:-Cloudflare}"

if [ "$R2_UPLOAD_ENABLED" = "true" ]; then
    : "${RCLONE_CONFIG_R2_ACCESS_KEY_ID:?RCLONE_CONFIG_R2_ACCESS_KEY_ID is required}"
    : "${RCLONE_CONFIG_R2_SECRET_ACCESS_KEY:?RCLONE_CONFIG_R2_SECRET_ACCESS_KEY is required}"
    : "${RCLONE_CONFIG_R2_ENDPOINT:?RCLONE_CONFIG_R2_ENDPOINT is required}"

    : "${R2_BUCKET:?R2_BUCKET environment variable is required}"
    : "${R2_CAMERA_OBJECT:?R2_CAMERA_OBJECT environment variable is required}"
    : "${R2_WEATHER_OBJECT:?R2_WEATHER_OBJECT environment variable is required}"

    export RCLONE_CONFIG_R2_ACCESS_KEY_ID
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
    export RCLONE_CONFIG_R2_ENDPOINT
fi

mkdir -p "$OUTPUT_DIR"

echo "$(date -Iseconds) webcam-capture: container started"
echo "$(date -Iseconds) webcam-capture: output file is ${OUTPUT_FILE}"
echo "$(date -Iseconds) webcam-capture: temp file is ${TMP_FILE}"
echo "$(date -Iseconds) webcam-capture: capture interval is ${CAPTURE_INTERVAL}s"
echo "$(date -Iseconds) webcam-capture: R2 upload enabled is ${R2_UPLOAD_ENABLED}"
echo "$(date -Iseconds) webcam-capture: R2 bucket is ${R2_BUCKET:-unset}"
echo "$(date -Iseconds) webcam-capture: R2 camera object is ${R2_CAMERA_OBJECT:-unset}"
echo "$(date -Iseconds) webcam-capture: weather enabled is ${WEATHER_ENABLED}"
echo "$(date -Iseconds) webcam-capture: weather interval is ${WEATHER_INTERVAL}s"
echo "$(date -Iseconds) webcam-capture: R2 weather object is ${R2_WEATHER_OBJECT}"

upload_file_to_r2() {
    SRC_FILE="$1"
    DEST_OBJECT="$2"
    LABEL="$3"

    if [ "$R2_UPLOAD_ENABLED" != "true" ]; then
        echo "$(date -Iseconds) webcam-capture: ${LABEL} R2 upload skipped"
        return 0
    fi

    R2_DEST="${R2_REMOTE_NAME}:${R2_BUCKET}/${DEST_OBJECT}"

    echo "$(date -Iseconds) webcam-capture: uploading ${SRC_FILE} to ${R2_DEST}"

    if rclone copyto \
        "$SRC_FILE" \
        "$R2_DEST" \
        --s3-no-check-bucket \
        --s3-no-head \
        --retries 3 \
        --low-level-retries 5 \
        --stats 0 \
        --log-level ERROR; then

        echo "$(date -Iseconds) webcam-capture: ${LABEL} R2 upload successful"
    else
        echo "$(date -Iseconds) webcam-capture: ${LABEL} R2 upload failed" >&2
    fi
}

capture_image() {
    echo "$(date -Iseconds) webcam-capture: capturing frame"

    if timeout 30s ffmpeg \
        -hide_banner \
        -loglevel error \
        -rtsp_transport tcp \
        -i "$RTSP_URL" \
        -frames:v 1 \
        -q:v 2 \
        -update 1 \
        -y "$TMP_FILE"; then

        if [ -s "$TMP_FILE" ]; then
            mv "$TMP_FILE" "$OUTPUT_FILE"
            echo "$(date -Iseconds) webcam-capture: capture successful"
            upload_file_to_r2 "$OUTPUT_FILE" "$R2_CAMERA_OBJECT" "camera image"
        else
            rm -f "$TMP_FILE"
            echo "$(date -Iseconds) webcam-capture: capture failed - empty file" >&2
        fi
    else
        rm -f "$TMP_FILE"
        echo "$(date -Iseconds) webcam-capture: capture failed - ffmpeg error" >&2
    fi
}

fetch_weather() {
    if [ "$WEATHER_ENABLED" != "true" ]; then
        return 0
    fi

    echo "$(date -Iseconds) webcam-capture: fetching weather"

    if curl \
        --fail \
        --silent \
        --show-error \
        --location \
        --max-time 20 \
        "$WEATHER_URL" \
        -o "$WEATHER_TMP_FILE"; then

        if [ -s "$WEATHER_TMP_FILE" ]; then
            mv "$WEATHER_TMP_FILE" "$WEATHER_FILE"
            echo "$(date -Iseconds) webcam-capture: weather fetch successful"
            upload_file_to_r2 "$WEATHER_FILE" "$R2_WEATHER_OBJECT" "weather"
        else
            rm -f "$WEATHER_TMP_FILE"
            echo "$(date -Iseconds) webcam-capture: weather fetch failed - empty file" >&2
        fi
    else
        rm -f "$WEATHER_TMP_FILE"
        echo "$(date -Iseconds) webcam-capture: weather fetch failed - curl error" >&2
    fi
}

LAST_WEATHER_FETCH=0

while true; do
    NOW="$(date +%s)"

    capture_image

    if [ "$WEATHER_ENABLED" = "true" ]; then
        WEATHER_AGE=$((NOW - LAST_WEATHER_FETCH))

        if [ "$LAST_WEATHER_FETCH" -eq 0 ] || [ "$WEATHER_AGE" -ge "$WEATHER_INTERVAL" ]; then
            fetch_weather
            LAST_WEATHER_FETCH="$(date +%s)"
        fi
    fi

    sleep "$CAPTURE_INTERVAL"
done