import boto3
from botocore.exceptions import ClientError
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
            # Force path-style so presigned URLs use the right format
            config=Config(signature_version="s3v4"),
        )
    return _s3


def upload_file(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    s = get_settings()
    get_s3().put_object(
        Bucket=s.s3_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def generate_presigned_url(key: str, expires_in: int = 3600) -> str:
    s = get_settings()
    return get_s3().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": s.s3_bucket_name,
            "Key": key,
        },
        ExpiresIn=expires_in,
    )


def delete_file(key: str) -> None:
    s = get_settings()
    try:
        get_s3().delete_object(Bucket=s.s3_bucket_name, Key=key)
    except ClientError:
        pass