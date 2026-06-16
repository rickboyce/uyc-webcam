/container/envs/add name=uyc-webcam-env key=RTSP_URL value="rtsp://USERNAME:PASSWORD@NVR_IP:554/cam/realmonitor?channel=9&subtype=0"
/container/envs/add name=uyc-webcam-env key=CAPTURE_INTERVAL value=60
/container/envs/add name=uyc-webcam-env key=OUTPUT_DIR value=/data

/container/envs/add name=uyc-webcam-env key=LAT value="54.5950"
/container/envs/add name=uyc-webcam-env key=LON value="-2.8412"
/container/envs/add name=uyc-webcam-env key=WEATHER_ENABLED value=true
/container/envs/add name=uyc-webcam-env key=WEATHER_INTERVAL value=900

/container/envs/add name=uyc-webcam-env key=RCLONE_CONFIG_R2_ACCESS_KEY_ID value="REPLACE_ME"
/container/envs/add name=uyc-webcam-env key=RCLONE_CONFIG_R2_SECRET_ACCESS_KEY value="REPLACE_ME"
/container/envs/add name=uyc-webcam-env key=RCLONE_CONFIG_R2_ENDPOINT value="https://ACCOUNT_ID.r2.cloudflarestorage.com"

/container/envs/add name=uyc-webcam-env key=R2_BUCKET value="uyc-webcam"
/container/envs/add name=uyc-webcam-env key=R2_CAMERA_OBJECT value="var/webcam.jpg"
/container/envs/add name=uyc-webcam-env key=R2_WEATHER_OBJECT value="var/weather.json"