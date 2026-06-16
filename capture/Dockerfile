FROM alpine:3.20

RUN apk add --no-cache \
    ffmpeg \
    rclone \
    curl \
    ca-certificates \
    tzdata

COPY capture-loop.sh /usr/local/bin/capture-loop.sh

RUN chmod +x /usr/local/bin/capture-loop.sh

ENTRYPOINT ["/usr/local/bin/capture-loop.sh"]