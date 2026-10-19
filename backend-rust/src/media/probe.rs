use crate::db::models::VideoMeta;
use serde_json::Value;
use tokio::process::Command;

pub fn is_codec_allowed(codec: &str) -> bool {
    let lower = codec.to_lowercase();
    lower == "h264" || lower == "avc1"
}

fn parse_rate(s: &str) -> Option<f64> {
    if s.is_empty() || s == "0/0" {
        return None;
    }
    let parts: Vec<&str> = s.split('/').collect();
    if parts.len() == 2 {
        let num: f64 = parts[0].parse().ok()?;
        let den: f64 = parts[1].parse().ok()?;
        if den > 0.0 {
            return Some((num / den * 1000.0).round() / 1000.0);
        }
    } else if let Ok(val) = s.parse::<f64>() {
        return Some((val * 1000.0).round() / 1000.0);
    }
    None
}

pub async fn probe_video(file_path: &str) -> Result<VideoMeta, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=width,height,codec_name,r_frame_rate,avg_frame_rate",
            "-of",
            "json",
            file_path,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let err_str = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe exited with error: {}", err_str));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Invalid ffprobe JSON output: {}", e))?;

    let duration = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .map(|d| d.round() as i64);

    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or_else(|| "No streams found in video".to_string())?;

    let video_stream = streams
        .iter()
        .find(|s| s.get("width").is_some() && s.get("height").is_some())
        .ok_or_else(|| "No video stream found".to_string())?;

    let width = video_stream.get("width").and_then(|w| w.as_i64());
    let height = video_stream.get("height").and_then(|h| h.as_i64());
    let codec = video_stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    let r_fps = video_stream
        .get("r_frame_rate")
        .and_then(|r| r.as_str())
        .and_then(parse_rate);
    let avg_fps = video_stream
        .get("avg_frame_rate")
        .and_then(|r| r.as_str())
        .and_then(parse_rate);
    let fps = r_fps.or(avg_fps);

    let is_portrait = match (width, height) {
        (Some(w), Some(h)) => h > w,
        _ => false,
    };

    Ok(VideoMeta {
        duration,
        width,
        height,
        is_portrait,
        fps,
        codec,
    })
}
