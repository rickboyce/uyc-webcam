FROM alpine:3.20

RUN apk add --no-cache \
    ffmpeg \
    rclone \
    curl \
    python3 \
    ca-certificates \
    tzdata

COPY capture-loop.sh /usr/local/bin/capture-loop.sh
COPY ics-to-json.py /usr/local/bin/ics-to-json.py

RUN chmod +x /usr/local/bin/capture-loop.sh

ENTRYPOINT ["/usr/local/bin/capture-loop.sh"]