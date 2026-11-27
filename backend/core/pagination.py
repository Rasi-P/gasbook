from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Default page-number pagination with a client-controllable page size.

    ``?page_size=N`` is honoured (capped at ``max_page_size``); the response envelope
    ``{count, next, previous, results}`` is unchanged.
    """

    page_size = 10
    page_size_query_param = "page_size"
    max_page_size = 200
