package app.gitvisualizer.events.support;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import org.springframework.stereotype.Component;

import app.gitvisualizer.events.client.model.GitHubEvent;

@Component
public class EventRingBuffer {

	private static final int MAX_SIZE = 300;

	private final Deque<GitHubEvent> events = new ArrayDeque<>();

	public synchronized void prependAll(List<GitHubEvent> newEvents) {
		for (int i = newEvents.size() - 1; i >= 0; i--) {
			events.addFirst(newEvents.get(i));
		}
		while (events.size() > MAX_SIZE) {
			events.removeLast();
		}
	}

	public synchronized List<GitHubEvent> snapshot(int limit) {
		int size = Math.min(limit, events.size());
		List<GitHubEvent> result = new ArrayList<>(size);
		int count = 0;
		for (GitHubEvent event : events) {
			result.add(event);
			count++;
			if (count >= size) {
				break;
			}
		}
		return result;
	}

	public synchronized int size() {
		return events.size();
	}
}
