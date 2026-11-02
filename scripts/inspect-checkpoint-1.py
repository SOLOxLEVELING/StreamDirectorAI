"""Parse actual CLI artifacts with Python stdlib; does not constitute model/editor review."""
import csv
import json
from pathlib import Path

report = []
for fixture_path in sorted(Path('test/fixtures').glob('*.json')):
    fixture = json.loads(fixture_path.read_text())
    root = Path('evidence/checkpoint-1') / fixture['name']
    document = json.loads((root / 'bookmarks.json').read_text())
    with (root / 'bookmarks.csv').open(newline='') as file:
        rows = list(csv.DictReader(file))
    bookmarks = document['bookmarks']
    assert len(rows) == len(bookmarks) == len(fixture['expected']), fixture['name']
    assert document['session']['mode'] == 'simulated'
    assert document['editorCompatibility'] == 'unverified'
    assert [row['id'] for row in rows] == [mark['id'] for mark in bookmarks]
    actual = [{key: mark[key] for key in ('signal', 'onsetMs', 'confirmedAtMs', 'tier')} for mark in bookmarks]
    assert actual == fixture['expected'], fixture['name']
    for mark, row in zip(bookmarks, rows):
        for key, column in [('detectedOffsetSeconds', 'detected_seconds'),
                            ('suggestedOffsetSeconds', 'suggested_seconds'),
                            ('editorOffsetSeconds', 'editor_seconds')]:
            assert float(row[column]) == mark[key]
        for evidence in mark['chatEvidence']:
            assert evidence['qualifyingBuckets'] >= document['session']['settings']['sustainSeconds']
            window = max(document['session']['settings']['activitySeconds'], document['session']['settings']['sustainSeconds'])
            assert evidence['validationWindowSeconds'] == window
            assert evidence['qualifyingBuckets'] <= window
            assert evidence['minimumBucketRate'] >= evidence['threshold']
            assert evidence['rate'] >= evidence['threshold']
            assert evidence['distinctChatters'] >= document['session']['settings']['minimumChatters']
    if fixture['name'] == 'sustained-burst':
        mark = bookmarks[0]
        assert (mark['onsetMs'], mark['confirmedAtMs']) == (60000, 65000)
        assert (mark['detectedOffsetSeconds'], mark['suggestedOffsetSeconds']) == (60, 45)
    elif fixture['name'] == 'sustained-burst-with-baseline':
        mark = bookmarks[0]
        assert (mark['onsetMs'], mark['confirmedAtMs']) == (100000, 105000)
        assert mark['metrics']['threshold'] == 6
        assert (mark['detectedOffsetSeconds'], mark['suggestedOffsetSeconds']) == (100, 85)
    elif fixture['name'] == 'platform-overlap':
        assert len(bookmarks) == len({mark['signal'] for mark in bookmarks}) == 7
        assert all(mark['tier'] == 'banner' for mark in bookmarks)
        assert sum(len(mark['chatEvidence']) for mark in bookmarks) == 1
        assert next(mark for mark in bookmarks if mark['signal'] == 'cheer')['metrics']['bits'] == 110
    elif fixture['name'] == 'surge-after-candidate-expiry':
        mark = bookmarks[0]
        assert (mark['onsetMs'], mark['confirmedAtMs']) == (190000, 195000)
        assert mark['metrics']['baseline'] == 121 / 60
        assert mark['metrics']['threshold'] == (121 / 60) * 3
        assert (mark['detectedOffsetSeconds'], mark['suggestedOffsetSeconds']) == (190, 175)
    report.append(f"{fixture['name']}: CSV/JSON parsed; {len(bookmarks)} records; explicit outputs, IDs, offsets and evidence safeguards passed.")

text = '\n'.join(report) + '\n'
Path('evidence/checkpoint-1/artifact-inspection.txt').write_text(text)
print(text, end='')
