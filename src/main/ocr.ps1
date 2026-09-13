param([Parameter(Mandatory = $true)][string]$ImagePath)
# Windows built-in OCR (Windows.Media.Ocr) -> JSON on stdout:
#   {"width":W,"height":H,"lines":[{"words":[{"t":"Habits","x":35,"y":34,"w":61,"h":16}]}]}
# Word boxes are image pixels. Errors go to stderr with exit code 1.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]

  # WinRT async operations have to be bridged to .NET tasks by hand in PowerShell 5.1.
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait() | Out-Null
    $task.Result
  }

  $full = [System.IO.Path]::GetFullPath($ImagePath)
  if (-not (Test-Path -LiteralPath $full)) { throw "Image not found: $full" }

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
  }
  if ($null -eq $engine) { throw 'No Windows OCR language is installed (Settings > Time & language > Language).' }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
    if ($bitmap.PixelWidth -gt $max -or $bitmap.PixelHeight -gt $max) { throw "Image is larger than ${max}px; capture a smaller area." }
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  } finally {
    $stream.Dispose()
  }

  $lines = New-Object System.Collections.ArrayList
  foreach ($line in $result.Lines) {
    $words = New-Object System.Collections.ArrayList
    foreach ($w in $line.Words) {
      $r = $w.BoundingRect
      [void]$words.Add([ordered]@{
          t = $w.Text
          x = [int][math]::Round($r.X); y = [int][math]::Round($r.Y)
          w = [int][math]::Round($r.Width); h = [int][math]::Round($r.Height)
        })
    }
    [void]$lines.Add([ordered]@{ words = $words })
  }

  $out = [ordered]@{ width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lines = $lines }
  [Console]::Out.Write(($out | ConvertTo-Json -Depth 6 -Compress))
  exit 0
} catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}
