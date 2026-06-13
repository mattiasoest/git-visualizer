package visualizer.github.github;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Component;

import visualizer.github.github.model.GitHubEvent;

@Component
public class EventDeduplicator {

	private static final int MAX_SEEN = 500;

	private final Set<String> seenIds = new LinkedHashSet<>();

	public synchronized List<GitHubEvent> filterNew(List<GitHubEvent> events) {
		return events.stream()
				.filter(event -> event.id() != null && seenIds.add(event.id()))
				.toList();
	}

	public synchronized void trim() {
		while (seenIds.size() > MAX_SEEN) {
			String oldest = seenIds.iterator().next();
			seenIds.remove(oldest);
		}
	}
}
