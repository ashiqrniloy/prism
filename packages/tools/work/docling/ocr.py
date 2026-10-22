#!/usr/bin/env python3
"""One-shot local Docling OCR. Stdin is the document. Stdout is one JSON object.

Host pins docling==2.130.0 and CPU torch (https://download.pytorch.org/whl/cpu),
prefetches models into --artifacts (~1.4 GiB), and runs this with egress off.
This process never opens a path or URL from the document. No npm dependency.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from io import BytesIO
from pathlib import Path

SUFFIXES = {
    "pdf": "pdf",
    "png": "png",
    "jpg": "jpg",
    "jpeg": "jpeg",
    "tif": "tif",
    "tiff": "tiff",
    "bmp": "bmp",
    "webp": "webp",
}


def main() -> None:
    logging.disable(logging.INFO)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TQDM_DISABLE"] = "1"
    real_out = sys.stdout

    def emit(payload: dict[str, object], code: int) -> None:
        real_out.write(json.dumps(payload, ensure_ascii=False) + "\n")
        real_out.flush()
        raise SystemExit(code)

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--format", required=True)
    parser.add_argument("--max-pages", required=True, type=int)
    parser.add_argument("--max-bytes", required=True, type=int)
    parser.add_argument("--max-text-bytes", required=True, type=int)
    parser.add_argument("--timeout-s", required=True, type=int)
    parser.add_argument("--artifacts", required=True)
    args = parser.parse_args()
    suffix = SUFFIXES.get(args.format)
    artifacts = args.artifacts
    if (
        suffix is None
        or args.max_pages < 1
        or args.max_bytes < 1
        or args.max_text_bytes < 1
        or args.timeout_s < 1
        or not artifacts
        or "\0" in artifacts
        or "://" in artifacts
    ):
        emit({"ok": False, "error": "unsupported"}, 1)

    data = sys.stdin.buffer.read(args.max_bytes + 1)
    if len(data) > args.max_bytes:
        emit({"ok": False, "error": "input_limit"}, 1)
    if not data:
        emit({"ok": False, "error": "io"}, 1)
    if not Path(artifacts).is_dir():
        emit({"ok": False, "error": "missing_models"}, 1)

    sys.stdout = sys.stderr
    try:
        markdown, pages = convert(data, suffix, args.max_pages, args.max_bytes, args.timeout_s, artifacts)
    except OcrFail as error:
        sys.stdout = real_out
        emit({"ok": False, "error": error.code}, 1)
    except Exception:
        sys.stdout = real_out
        emit({"ok": False, "error": "io"}, 1)
    sys.stdout = real_out
    if pages < 1 or pages > args.max_pages:
        emit({"ok": False, "error": "partial"}, 1)
    if len(markdown.encode("utf-8")) > args.max_text_bytes:
        emit({"ok": False, "error": "output_limit"}, 1)
    emit({"ok": True, "markdown": markdown, "pages": pages}, 0)


class OcrFail(Exception):
    def __init__(self, code: str) -> None:
        self.code = code


def convert(
    data: bytes,
    suffix: str,
    max_pages: int,
    max_bytes: int,
    timeout_s: int,
    artifacts: str,
) -> tuple[str, int]:
    from docling.datamodel.base_models import ConversionStatus, DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

    opts = PdfPipelineOptions(
        artifacts_path=artifacts,
        enable_remote_services=False,
        allow_external_plugins=False,
        do_ocr=True,
        generate_page_images=False,
        do_picture_description=False,
        do_picture_classification=False,
        ocr_options=RapidOcrOptions(backend="torch"),
        document_timeout=float(timeout_s),
    )
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF, InputFormat.IMAGE],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
        },
    )
    result = converter.convert(
        DocumentStream(name=f"input.{suffix}", stream=BytesIO(data)),
        max_num_pages=max_pages,
        max_file_size=max_bytes,
        raises_on_error=False,
    )
    if result.status != ConversionStatus.SUCCESS:
        raise OcrFail(failure_code(result))
    markdown = result.document.export_to_markdown()
    if not isinstance(markdown, str):
        raise OcrFail("io")
    return markdown, int(result.document.num_pages())


def failure_code(result: object) -> str:
    errors = getattr(result, "errors", None) or []
    for err in errors:
        blob = f"{getattr(err, 'error_category', '')} {getattr(err, 'error_message', '')}".lower()
        if "policy" in blob or "max_num_pages" in blob or "max_file_size" in blob:
            return "over_page"
    return "partial"


if __name__ == "__main__":
    main()
