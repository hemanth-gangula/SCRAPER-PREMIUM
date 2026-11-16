#!/usr/bin/env bash
# Render build script for the Flask backend
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Creating storage directory on persistent disk ==="
mkdir -p /data/storage/businesses
mkdir -p /data/storage/jobs
mkdir -p /data/storage/logs
mkdir -p /data/storage/checkpoints
mkdir -p /data/storage/deduplication
mkdir -p /data/storage/quotas
mkdir -p /data/storage/schedules
mkdir -p /data/storage/settings
mkdir -p /data/storage/exports
mkdir -p /data/storage/backups

echo "=== Build complete ==="
