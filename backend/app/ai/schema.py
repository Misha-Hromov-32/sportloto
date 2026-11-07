from typing import Any

from pydantic import BaseModel

from app.ai.provider import ResponseSchema


def _simplify(node: Any, defs: dict[str, Any]) -> Any:  # noqa: ANN401
    if isinstance(node, list):
        return [_simplify(item, defs) for item in node]
    if not isinstance(node, dict):
        return node
    if "$ref" in node:
        return _simplify(defs[node["$ref"].rsplit("/", 1)[-1]], defs)
    variants = node.get("anyOf")
    if isinstance(variants, list):
        # `X | None` → X: часть провайдеров не понимает anyOf, а отсутствие поля и так даёт None.
        non_null = [v for v in variants if v != {"type": "null"}]
        if len(non_null) == 1:
            merged = {k: v for k, v in node.items() if k != "anyOf"} | non_null[0]
            return _simplify(merged, defs)
    result: dict[str, Any] = {}
    for key, value in node.items():
        if key in {"title", "$defs", "default"}:
            continue
        if key == "properties" and isinstance(value, dict):
            result[key] = {name: _simplify(sub, defs) for name, sub in value.items()}
        else:
            result[key] = _simplify(value, defs)
    return result


def response_schema(model: type[BaseModel], description: str) -> ResponseSchema:
    raw = model.model_json_schema()
    simplified = _simplify(raw, raw.get("$defs", {}))
    return ResponseSchema(name=model.__name__, description=description, json_schema=simplified)
