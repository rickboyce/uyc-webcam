#!/bin/sh
set -eu

: "${RTSP_URL:?RTSP_URL environment variable is required}"

CAPTURE_INTERVAL="${CAPTURE_INTERVAL:-60}"

OUTPUT_DIR="${OUTPUT_DIR:-/data}"
CAMERA_TMP_FILE="${OUTPUT_DIR}/webcam-working.jpg"
CAMERA_FILE="${OUTPUT_DIR}/webcam.jpg"

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

    export RCLONE_CONFIG_R2_ACCESS_KEY_ID
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
    export RCLONE_CONFIG_R2_ENDPOINT
fi

mkdir -p "$OUTPUT_DIR"

echo "$(date -Iseconds) webcam-capture: container started"
echo "$(date -Iseconds) webcam-capture: R2 upload enabled is ${R2_UPLOAD_ENABLED}"
echo "$(date -Iseconds) webcam-capture: R2 bucket is ${R2_BUCKET:-unset}"
echo "$(date -Iseconds) webcam-capture: camera interval is ${CAPTURE_INTERVAL}s"
echo "$(date -Iseconds) webcam-capture: R2 camera object is ${R2_CAMERA_OBJECT:-unset}"

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
        -y "$CAMERA_TMP_FILE"; then

        if [ -s "$CAMERA_TMP_FILE" ]; then
            mv "$CAMERA_TMP_FILE" "$CAMERA_FILE"
            echo "$(date -Iseconds) webcam-capture: capture successful"
            upload_file_to_r2 "$CAMERA_FILE" "${R2_CAMERA_OBJECT:-}" "camera image"
        else
            rm -f "$CAMERA_TMP_FILE"
            echo "$(date -Iseconds) webcam-capture: capture failed - empty file" >&2
        fi
    else
        rm -f "$CAMERA_TMP_FILE"
        echo "$(date -Iseconds) webcam-capture: capture failed - ffmpeg error" >&2
    fi
}

while true; do
    capture_image
    sleep "$CAPTURE_INTERVAL"
done