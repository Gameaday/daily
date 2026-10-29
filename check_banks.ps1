$games = @('trace','recycle-grid','recycle-rings','sprint','sift','museum','lightbox','fermi','cipher','well-actually','rounds','timeline','bogus')
foreach ($g in $games) {
    $html = gc "$g\\index.html" -Raw
    if ($html -match 'fetchPuzzle') {
        Write-Host $g '=> fetchPuzzle OK'
    } else {
        Write-Host $g '=> MISSING fetchPuzzle'
    }
    if ($html -match 'const BANKS') {
        Write-Host $g '=> WARNING: still has BANKS'
    }
    if ($html -match 'isSolo') {
        Write-Host $g '=> WARNING: still has isSolo'
    }
}