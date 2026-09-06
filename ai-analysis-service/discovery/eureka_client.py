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
        # instance_host defaults to the pod's own hostname when unset, which
        # becomes the registered Eureka "hostName" field - the one other
        # services' client-side load balancers actually build request URLs
        # from. Left unset, api-gateway tries to DNS-resolve the raw pod
        # hostname (unresolvable in-cluster) instead of using instance_ip,
        # the same problem the Java services avoid via
        # EUREKA_INSTANCE_PREFER_IP_ADDRESS=true - setting it to the same IP
        # here is this client's equivalent.
        instance_host=ip_address,
        instance_id=f"AI-ANALYSIS-SERVICE-{hostname}-{port}",
        renewal_interval_in_secs=30
    )


async def deregister_from_eureka():
    """Called on SIGTERM (see main.py's lifespan shutdown) so Kubernetes
    rolling deploys don't leave a dead instance registered until the next
    lease-expiry timeout - other services would keep routing to it via
    Eureka lookups until then otherwise."""
    await eureka_client.stop_async()