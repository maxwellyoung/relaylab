#!/usr/bin/env python3
"""Exercise the native reviewer on its dedicated emulator against a local group API.

Resets only dev.relaylab.reviewer on the named RelayLabReviewerQA AVD. Never
accepts a physical serial. Uses synthetic experiments; preserves their reviews
as local checkpoint evidence. Logs/captures belong in ignored outputs/.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--serial', required=True)
parser.add_argument('--adb', default=str(Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk'))) / 'platform-tools/adb'))
parser.add_argument('--api', default='http://127.0.0.1:3118')
parser.add_argument('--output', default='outputs/android-reviewer-2026-10-08')
args = parser.parse_args()
if not re.fullmatch(r'emulator-\d+', args.serial):
    parser.error('Only a dedicated emulator serial is accepted; no physical-device actions.')
if args.api != 'http://127.0.0.1:3118':
    parser.error('This destructive test fixture is restricted to the local port-3118 demo.')
out = Path(args.output).resolve()
if 'outputs' not in out.parts:
    parser.error('Keep raw proof inside an ignored outputs/ directory.')
out.mkdir(parents=True, exist_ok=True)
(out / 'smoke-result.json').write_text(json.dumps({'result': 'running', 'serial': args.serial}) + '\n')
package = 'dev.relaylab.reviewer'


def adb(*command):
    return subprocess.check_output([args.adb, '-s', args.serial, *command], timeout=25).decode().strip()


if adb('emu', 'avd', 'name').splitlines()[0].strip() != 'RelayLabReviewerQA':
    parser.error('The selected emulator must be the dedicated RelayLabReviewerQA AVD.')


def http(path, method='GET', body=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(args.api + path, headers=headers, method=method,
                                    data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(request, timeout=8) as response:
        assert response.status == expected, (path, response.status)
        return json.load(response) if expected != 204 else None


def nodes():
    for attempt in range(3):
        try:
            adb('shell', 'uiautomator', 'dump', '/sdcard/relaylab-ui.xml')
            return list(ET.fromstring(adb('shell', 'cat', '/sdcard/relaylab-ui.xml')).iter('node'))
        except (subprocess.CalledProcessError, ET.ParseError):
            if attempt == 2:
                raise
            time.sleep(1)


def match(text=None, starts=None, desc=None, resource=None, tree=None):
    for node in tree if tree is not None else nodes():
        value = node.attrib
        if ((text is not None and value.get('text') == text)
            or (starts is not None and value.get('text', '').startswith(starts))
            or (desc is not None and value.get('content-desc') == desc)
            or (resource is not None and value.get('resource-id', '').endswith(resource))):
            return node
    return None


def wait_for(timeout=25, **query):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        node = match(**query)
        if node is not None:
            return node
        time.sleep(.5)
    raise AssertionError('UI did not appear: ' + str(query))


def tap(node):
    assert node.attrib.get('enabled') == 'true', 'Control is disabled'
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.attrib['bounds']))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def swipe(direction='down'):
    tree = nodes()
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', tree[0].attrib['bounds']))
    high, low = int(y2 * .8), int(y2 * .3)
    start, end = (high, low) if direction == 'down' else (low, high)
    adb('shell', 'input', 'swipe', str(x2 // 2), str(start), str(x2 // 2), str(end), '250')


def find_visible(**query):
    for _ in range(15):
        tree = nodes()
        node = match(tree=tree, **query)
        if node is not None:
            _, _, width, height = map(int, re.findall(r'\d+', tree[0].attrib['bounds']))
            _, top_y, _, bottom_y = map(int, re.findall(r'\d+', node.attrib['bounds']))
            center = (top_y + bottom_y) // 2
            # Accessibility can report a partly visible control underneath the
            # navigation bar. Bring its center into the content before tapping.
            if height * .08 <= center <= height * .90:
                return node
            swipe('up' if center < height * .08 else 'down')
        else:
            swipe()
    raise AssertionError('Control not found: ' + str(query))


def find_and_tap(**query):
    tap(find_visible(**query))


def top():
    for _ in range(15):
        if match(text='RELAYLAB / REVIEWER') is not None:
            return
        swipe('up')
    raise AssertionError('Queue top not reached')


def capture(name):
    with (out / (name + '.png')).open('wb') as stream:
        subprocess.run([args.adb, '-s', args.serial, 'exec-out', 'screencap', '-p'], stdout=stream, check=True, timeout=20)


def launch():
    adb('shell', 'am', 'start', '-n', package + '/.MainActivity')


def seed(token, label):
    experiment = http('/api/experiments', 'POST', {'name': label, 'behavior': 'healthy', 'payload': {'checkpoint': 'native-android'}}, expected=201)
    run = http('/api/experiments/' + str(experiment['id']) + '/runs', 'POST', expected=201)
    assert run['outcome'] == 'success'
    review = http('/api/runs/' + str(run['id']) + '/reviews', 'POST', token=token, expected=201)
    return review


def decision(token, review_id, status, feedback):
    end = time.monotonic() + 20
    while time.monotonic() < end:
        review = http('/api/reviews/' + str(review_id), token=token)
        if review['status'] == status:
            assert review['feedback'] == feedback
            assert review['run']['outcome'] == 'success'
            return review
        time.sleep(.5)
    raise AssertionError('Researcher did not receive the Android decision')


def write_feedback(value):
    tap(wait_for(desc='Review feedback'))
    adb('shell', 'input', 'text', value.replace(' ', '%s'))
    adb('shell', 'input', 'keyevent', '111')  # Escape hides the keyboard without leaving the review.


def notification_record(review_id):
    dump = adb('shell', 'dumpsys', 'notification', '--noredact')
    return 'tag=review-' + str(review_id) + ' ' in dump and 'pkg=' + package in dump


assert http('/health')['executionTransport'] == 'grpc'
researcher = http('/api/demo-sessions', 'POST', {'actorId': 'researcher-a'}, expected=201)['token']
reviewer = None
checked = []
def check(value):
    checked.append(value)
    print(value, flush=True)
try:
    suffix = uuid.uuid4().hex[:6]
    first = seed(researcher, 'Android checkpoint ' + suffix)
    assert adb('shell', 'pm', 'clear', package) == 'Success'
    launch()
    tap(wait_for(text='Connect as demo reviewer'))
    wait_for(text='Queue updated just now.')
    capture('queue')

    find_and_tap(text='Enable notifications')
    tap(wait_for(resource='permission_deny_button'))
    find_visible(text='Notification permission denied. The review queue remains available.')
    check('permission denial leaves native review usable')
    top()
    find_and_tap(starts='Android checkpoint ' + suffix)
    find_and_tap(text='Approve run')
    wait_for(text='Enter feedback (1–2000 characters) before deciding.')
    feedback = 'Android evidence checked after rotation.'
    write_feedback(feedback)
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    time.sleep(1)
    find_visible(text=feedback)
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    time.sleep(1)
    find_visible(text=feedback)
    check('required feedback and rotation retain draft')
    find_and_tap(text='Approve run')
    decision(researcher, first['id'], 'approved', feedback)
    wait_for(text=feedback)
    capture('approved')
    check('native approval and feedback visible through researcher HTTP API')

    find_and_tap(text='Back to queue')
    find_and_tap(text='Enable notifications')
    tap(wait_for(resource='permission_allow_button'))
    find_visible(text='Disable notifications')
    end = time.monotonic() + 20
    while time.monotonic() < end:
        prefs = adb('shell', 'run-as', package, 'cat', 'shared_prefs/reviewer.xml')
        if 'name="seen"' in prefs:
            break
        time.sleep(.5)
    else:
        raise AssertionError('Notification baseline was not stored')
    assert not notification_record(first['id']), 'Existing backlog must not notify'
    check('notification opt-in establishes baseline without backlog alerts')

    # Background the activity; the debug-only, shell-permission receiver enqueues
    # the same real worker as the periodic scheduler. No synthetic notification.
    adb('shell', 'input', 'keyevent', '3')
    second = seed(researcher, 'Android notification ' + suffix)
    jobs = adb('shell', 'dumpsys', 'jobscheduler')
    assert re.search(r'^  JOB [^\n]*' + re.escape(package) + r'/androidx.work.impl.background.systemjob.SystemJobService', jobs, re.MULTILINE), 'Periodic worker is not scheduled'
    adb('shell', 'am', 'broadcast', '-a', 'dev.relaylab.reviewer.CHECK_REVIEWS', '-n', package + '/.DebugPollReceiver')
    end = time.monotonic() + 20
    while time.monotonic() < end:
        if notification_record(second['id']):
            break
        time.sleep(.5)
    else:
        raise AssertionError('The real background worker did not post a notification')
    adb('shell', 'cmd', 'statusbar', 'expand-notifications')
    capture('background-notification')
    tap(wait_for(text='New run ready for review'))
    wait_for(text='Android notification ' + suffix)
    capture('notification-opened-review')
    check('actual background WorkManager job posts system notification; tap opens the matching review')
    second_feedback = 'Please repeat with a larger sample.'
    write_feedback(second_feedback)
    find_and_tap(text='Reject run')
    decision(researcher, second['id'], 'rejected', second_feedback)
    check('native rejection preserves execution outcome and returns feedback')

    # Process recreation fetches persisted evidence rather than keeping a demo bearer token.
    adb('shell', 'am', 'force-stop', package)
    launch()
    wait_for(text='Queue updated just now.')
    find_and_tap(starts='Android notification ' + suffix)
    wait_for(text=second_feedback)
    capture('restored-decision')
    check('app process recreation reconnects and reloads the persisted decision')
    find_and_tap(text='Back to queue')
    find_and_tap(text='Disable notifications')
    assert not notification_record(second['id'])
    end = time.monotonic() + 5
    while time.monotonic() < end:
        prefs = adb('shell', 'run-as', package, 'cat', 'shared_prefs/reviewer.xml')
        if 'name="notifications" value="false"' in prefs:
            break
        time.sleep(.2)
    else:
        raise AssertionError('Notification disable did not persist')
    check('disable clears posted notifications and cancels future checks')

    # A competing reviewer wins before the stale Android detail is submitted.
    third = seed(researcher, 'Android conflict ' + suffix)
    top()
    find_and_tap(text='Refresh queue')
    wait_for(text='Queue updated just now.')
    find_and_tap(starts='Android conflict ' + suffix)
    write_feedback('This draft must not overwrite the winning decision.')
    reviewer = http('/api/demo-sessions', 'POST', {'actorId': 'reviewer'}, expected=201)['token']
    http('/api/reviews/' + str(third['id']), 'PATCH', {'status': 'rejected', 'feedback': 'Another reviewer decided first.'}, token=reviewer)
    stale_button = match(text='Approve run')
    if stale_button is not None and stale_button.attrib.get('enabled') == 'true':
        tap(stale_button)
    # An automatic refresh may already have retrieved the winning decision.
    wait_for(text='Another reviewer decided first.')
    assert http('/api/reviews/' + str(third['id']), token=researcher)['status'] == 'rejected'
    capture('conflict-recovered')
    check('competing decision converges to the winning feedback without overwriting it')
    result = {'result': 'passed', 'serial': args.serial, 'avd': 'RelayLabReviewerQA', 'androidApi': adb('shell', 'getprop', 'ro.build.version.sdk'),
              'checks': checked, 'reviews': [first['id'], second['id'], third['id']],
              'limits': ['synthetic local demo identities', 'emulator proof only', 'debug receiver requests the real worker for deterministic background verification; natural periodic delivery timing not measured']}
    (out / 'smoke-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
finally:
    http('/api/demo-sessions/current', 'DELETE', token=researcher, expected=204)
    if reviewer:
        http('/api/demo-sessions/current', 'DELETE', token=reviewer, expected=204)
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
