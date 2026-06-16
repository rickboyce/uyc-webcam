/container/add \
    name=uyc-webcam-capture \
    remote-image=rickboyce/uyc-webcam-capture:latest \
    interface=veth_uyc-webcam \
    rroot-dir=/containers/uyc-webcam-capture/root \
    mount=/containers/uyc-webcam-capture/data:/data:rw \
    envlist=uyc-webcam-env \
    logging=yes \
    start-on-boot=yes