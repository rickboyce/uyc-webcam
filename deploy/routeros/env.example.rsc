/container/envs/add name=uyc-webcam-env key=RTSP_URL value="rtsp://USERNAME:PASSWORD@NVR_IP:554/cam/realmonitor?channel=9&subtype=0"
/container/envs/add name=uyc-webcam-env key=CAPTURE_INTERVAL value=60
/container/envs/add name=uyc-webcam-env key=OUTPUT_DIR value=/data

/container/envs/add name=uyc-webcam-env key=RCLONE_CONFIG_R2_ACCESS_KEY_ID value="REPLACE_ME"
/container/envs/add name=uyc-webcam-env key=RCLONE_CONFIG_R2_SECRET_ACCESS_KEY value="REPLACE_ME"
/container/envs/add name=uyc-webcam-env key=RCLONE_CONFIG_R2_ENDPOINT value="https://ACCOUNT_ID.r2.cloudflarestorage.com"

/container/envs/add name=uyc-webcam-env key=R2_BUCKET value="uyc-webcam"
/container/envs/add name=uyc-webcam-env key=R2_CAMERA_OBJECT value="var/webcam.jpg"