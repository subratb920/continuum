"""Mapping between polars types and the contract's schema types."""

from __future__ import annotations

import polars as pl

META_COLUMNS = ("_id", "_source", "_licence", "_split", "_flags")


def type_name(dtype) -> str:
    """Contract type: string, integer, float, boolean, date, datetime, list, struct."""
    if dtype == pl.Boolean:
        return "boolean"
    if dtype.is_integer():
        return "integer"
    if dtype.is_float() or dtype.is_decimal():
        return "float"
    if dtype == pl.Date:
        return "date"
    if isinstance(dtype, pl.Datetime) or dtype == pl.Datetime:
        return "datetime"
    if isinstance(dtype, (pl.List, pl.Array)) or dtype in (pl.List, pl.Array):
        return "list"
    if isinstance(dtype, pl.Struct) or dtype == pl.Struct:
        return "struct"
    return "string"


def storable(dtype):
    """The type a column is stored as. Keeps Parquet simple for hyparquet:
    no categoricals, decimals, durations, times, binaries or null-typed columns."""
    if dtype == pl.Null or dtype in (pl.Categorical, pl.Enum) or isinstance(dtype, (pl.Categorical, pl.Enum)):
        return pl.String
    if dtype == pl.Object or dtype == pl.Time or dtype == pl.Duration or isinstance(dtype, pl.Duration):
        return pl.String
    if dtype.is_decimal():
        return pl.Float64
    if dtype == pl.Binary:
        return pl.String
    if isinstance(dtype, pl.Datetime) and dtype.time_unit == "ns":
        return pl.Datetime("us", dtype.time_zone)
    if isinstance(dtype, pl.Array):
        return pl.List(storable(dtype.inner))
    if isinstance(dtype, pl.List):
        return pl.List(storable(dtype.inner))
    if isinstance(dtype, pl.Struct):
        return pl.Struct([pl.Field(f.name, storable(f.dtype)) for f in dtype.fields])
    return dtype


def supertype(a, b):
    """A type both columns fit in, or None when there is none worth guessing."""
    if a == b:
        return a
    if a == pl.Null:
        return b
    if b == pl.Null:
        return a
    if a.is_numeric() and b.is_numeric():
        if a.is_integer() and b.is_integer():
            return pl.Int64
        return pl.Float64
    nested = (pl.List, pl.Struct, pl.Array)
    if isinstance(a, nested) or isinstance(b, nested):
        return None
    return pl.String
