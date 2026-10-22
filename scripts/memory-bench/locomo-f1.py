"""LoCoMo QA scoring protocol, CC BY-NC 4.0.
Source: snap-research/locomo at 3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376,
task_eval/evaluation.py (normalize_answer, f1_score, f1, eval_question_answering).
Uses the same NLTK Porter stemmer; no corpus download is needed.
"""
import json
import re
import string
import sys
from collections import Counter
import nltk
from nltk.stem import PorterStemmer

if nltk.__version__ != "3.9.2":
    raise RuntimeError("benchmark requires nltk==3.9.2")

stemmer = PorterStemmer()


def words(text):
    text = ''.join(char for char in text.lower() if char not in string.punctuation)
    text = re.sub(r'\b(a|an|the|and)\b', ' ', text)
    return [stemmer.stem(word) for word in text.split()]


def overlap(prediction, gold):
    predicted, expected = words(prediction), words(gold)
    common = sum((Counter(predicted) & Counter(expected)).values())
    return 2 * common / (len(predicted) + len(expected)) if common else 0


def score(ability, response, answer):
    if ability == 'adversarial':
        return int('no information available' in response.lower() or 'not mentioned' in response.lower())
    if ability == 'open-domain':
        answer = answer.split(';')[0].strip()
    if ability == 'multi-hop':
        expected, predicted = answer.split(','), response.split(',')
        return sum(max(overlap(p.strip(), g.strip()) for p in predicted) for g in expected) / len(expected)
    return overlap(response, answer)


if __name__ == '__main__':
    item = json.load(sys.stdin)
    print(max(score(item['ability'], item['response'], answer) for answer in item['answers']))
