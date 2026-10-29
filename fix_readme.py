#!/usr/bin/env python3
import sys

with open('C:\\Project\\daily\\README.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the test text and duplicate old content
# First, find and remove line 3 which starts with "test"
lines = content.split('\n')

# Find the test text line
new_lines = []
skip_until_how = False
for i, line in enumerate(lines):
    if 'test ·' in line:
        continue  # skip this line
    if '## How' in line and 'daily' in line.lower() and i > 20:
        skip_until_how = True
        # Still include this line but everything after should be truncated
    if not skip_until_how:
        new_lines.append(line)
    elif '## How' in line and 'daily' in line.lower() and i > 20:
        # This is the line we want to keep, then stop
        new_lines.append(line)
        skip_until_how = False  # Stop after this

# Actually truncate after the first '## How daily' occurrence
found_how = False
final_lines = []
for line in new_lines:
    if '## How' in line and 'daily' in line.lower() and not found_how:
        final_lines.append(line)
        found_how = True
    elif found_how:
        # We're past the How section, stop
        break
    else:
        final_lines.append(line)

result = '\n'.join(final_lines)

with open('C:\\Project\\daily\\README.md', 'w', encoding='utf-8') as f:
    f.write(result)
print('Done fixing README')