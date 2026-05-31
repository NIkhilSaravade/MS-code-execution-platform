from py_eureka_client import eureka_client


async def get_service_url(service_name: str):
    """
    Fetch service instance from Eureka.
    """

    instance = await eureka_client.get_instance_async(service_name)

    return f"http://{instance.ip_addr}:{instance.port}"