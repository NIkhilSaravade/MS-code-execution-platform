from py_eureka_client import eureka_client
import socket
import os


async def register_with_eureka():

    hostname = socket.gethostname()
    ip_address = socket.gethostbyname(hostname)

    port = int(os.getenv("PORT", 8000))
    eureka_server = os.getenv("EUREKA_SERVER_URL", "http://localhost:8761/eureka")

    await eureka_client.init_async(
        eureka_server=eureka_server,
        app_name="AI-ANALYSIS-SERVICE",
        instance_port=port,
        instance_ip=ip_address,
        instance_id=f"AI-ANALYSIS-SERVICE-{hostname}-{port}",
        renewal_interval_in_secs=30
    )