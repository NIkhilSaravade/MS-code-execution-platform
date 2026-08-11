from py_eureka_client import eureka_client


async def get_service_url(service_name: str):
    """
    Resolve a live base URL (e.g. "http://submission-service:8083") for the
    given Eureka app name.

    py_eureka_client has no get_instance_async - walk_nodes_async is the
    real async resolution API. It's built around "walk to a node, then run
    this callable against it" (its usual caller is do_service_async, which
    performs the actual HTTP call) rather than "just give me the URL", so a
    pass-through walker (return the already-resolved base URL as-is) is
    what adapts it to this simpler use.
    """

    url = await eureka_client.walk_nodes_async(app_name=service_name, walker=lambda url: url)
    # walk_nodes_async's resolved URL has a trailing slash (it's built to have
    # a request path appended directly) - callers here build their own path
    # with a leading slash, e.g. f"{base}/submissions/{id}", so strip it to
    # avoid a double slash.
    return url.rstrip("/")