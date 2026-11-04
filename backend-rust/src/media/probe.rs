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
            "format=duration:stream=width,height,codec_name,r_frame_rate,avg_frame_rate,side_data_list:stream_side_data=rotation:stream_tags=rotate",
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

    let mut width = video_stream.get("width").and_then(|w| w.as_i64());
    let mut height = video_stream.get("height").and_then(|h| h.as_i64());
    let codec = video_stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    // Check side_data_list rotation or tags.rotate
    let mut rotation_deg: Option<i64> = None;
    if let Some(side_data) = video_stream.get("side_data_list").and_then(|sd| sd.as_array()) {
        for sd in side_data {
            if let Some(rot) = sd.get("rotation").and_then(|r| r.as_i64().or_else(|| r.as_f64().map(|f| f as i64))) {
                rotation_deg = Some(rot);
                break;
            }
        }
    }
    if rotation_deg.is_none() {
        if let Some(tags) = video_stream.get("tags") {
            if let Some(rot_str) = tags.get("rotate").and_then(|r| r.as_str()) {
                rotation_deg = rot_str.parse::<i64>().ok();
            }
        }
    }

    if let Some(deg) = rotation_deg {
        let normalized = ((deg % 360) + 360) % 360;
        if normalized == 90 || normalized == 270 {
            std::mem::swap(&mut width, &mut height);
        }
    }

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
