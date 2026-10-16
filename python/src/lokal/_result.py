from __future__ import annotations

import dataclasses
from typing import Any


def _camel(name: str) -> str:
    head, *rest = name.split('_')
    return head + ''.join(part[:1].upper() + part[1:] for part in rest)


def _convert(value: Any, camel: bool) -> Any:
    if isinstance(value, Result):
        return value.to_dict(camel=camel)
    if isinstance(value, (list, tuple)):
        return [_convert(v, camel) for v in value]
    return value


class Result:
    """Base for result dataclasses: attribute access, plus `to_dict()` for JSON responses."""

    __slots__ = ()

    def to_dict(self, *, camel: bool = False) -> dict[str, Any]:
        """Fields as a dict, leaving out those that are None.

        ``camel=True`` uses the same keys as the TypeScript package (``birthDate``, ``postalCode``), handy when a
        frontend shares types with ``@lokal-id/core``.
        """
        out: dict[str, Any] = {}
        for f in dataclasses.fields(self):  # type: ignore[arg-type]
            value = getattr(self, f.name)
            if value is None:
                continue
            out[_camel(f.name) if camel else f.name] = _convert(value, camel)
        return out
