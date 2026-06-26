[Unit]
Description=Git Visualizer Spring Boot API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gitvisualizer
Group=gitvisualizer
WorkingDirectory=/opt/gitvisualizer
EnvironmentFile=-/etc/gitvisualizer/env
ExecStart=/usr/bin/java -Xms128m -Xmx512m -jar /opt/gitvisualizer/gitvisualizer.jar
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
