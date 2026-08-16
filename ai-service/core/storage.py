import boto3
from botocore.config import Config
from core.config import get_settings

_s3 = None


def get_s3():
    global _s3
    if _s3 is None:
        s = get_settings()
        _s3 = boto3.client(
            "s3",
            aws_access_key_id=s.aws_access_key_id,
            aws_secret_access_key=s.aws_secret_access_key,
            region_name=s.aws_region,
            config=Config(signature_version="s3v4"),
        )
    return _s3


def download_file(key: str) -> bytes:
    """Fetch an S3 object's bytes."""
    s = get_settings()
    obj = get_s3().get_object(Bucket=s.s3_bucket_name, Key=key)
    return obj["Body"].read()


def upload_file(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload bytes to S3 at the given key."""
    s = get_settings()
    get_s3().put_object(
        Bucket=s.s3_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key