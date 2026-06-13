package app.gitvisualizer.events.service;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Service;

import app.gitvisualizer.config.GitHubApiProperties;
import app.gitvisualizer.events.client.GitHubEventsClient;
import app.gitvisualizer.events.client.GitHubEventsResponse;
import app.gitvisualizer.events.client.model.GitHubEvent;
import app.gitvisualizer.events.support.EventDeduplicator;
import app.gitvisualizer.events.support.EventFilter;

@Service
public class EventIngestionService {

	private static final Logger log = LoggerFactory.getLogger(EventIngestionService.class);
	private static final int MAX_BACKOFF_SECONDS = 600;

	private final GitHubEventsClient client;
	private final EventDeduplicator deduplicator;
	private final EventFilter eventFilter;
	private final TaskScheduler taskScheduler;
	private final EventReleaseScheduler releaseScheduler;
	private final GitHubApiProperties properties;

	private final AtomicInteger backoffSeconds = new AtomicInteger(0);
	private final AtomicReference<Instant> lastPollAt = new AtomicReference<>();

	public EventIngestionService(
			GitHubEventsClient client,
			EventDeduplicator deduplicator,
			EventFilter eventFilter,
			TaskScheduler taskScheduler,
			EventReleaseScheduler releaseScheduler,
			GitHubApiProperties properties) {
		this.client = client;
		this.deduplicator = deduplicator;
		this.eventFilter = eventFilter;
		this.taskScheduler = taskScheduler;
		this.releaseScheduler = releaseScheduler;
		this.properties = properties;
	}

	@EventListener(ApplicationReadyEvent.class)
	@ConditionalOnProperty(name = "github.api.polling-enabled", havingValue = "true", matchIfMissing = true)
	public void startPolling() {
		scheduleNextPoll(0);
	}

	public Instant getLastPollAt() {
		return lastPollAt.get();
	}

	private void poll() {
		try {
			GitHubEventsResponse response = client.fetchEvents();
			lastPollAt.set(Instant.now());
			backoffSeconds.set(0);

			int delaySeconds = Math.max(properties.minPollIntervalSeconds(), response.pollIntervalSeconds());

			if (!response.notModified()) {
				processNewEvents(response.events(), delaySeconds);
			}
			else {
				log.debug("GitHub events not modified (304)");
			}

			scheduleNextPoll(delaySeconds);
		}
		catch (GitHubEventsClient.GitHubApiException ex) {
			int delay = ex.isRetryable()
					? Math.min(MAX_BACKOFF_SECONDS, backoffSeconds.updateAndGet(current -> current == 0 ? 60 : current * 2))
					: properties.minPollIntervalSeconds();
			log.warn("GitHub poll failed, retrying in {}s", delay, ex);
			scheduleNextPoll(delay);
		}
		catch (Exception ex) {
			int delay = Math.min(MAX_BACKOFF_SECONDS, backoffSeconds.updateAndGet(current -> current == 0 ? 60 : current * 2));
			log.error("Unexpected poll failure, retrying in {}s", delay, ex);
			scheduleNextPoll(delay);
		}
	}

	private void processNewEvents(List<GitHubEvent> fetchedEvents, int windowSeconds) {
		List<GitHubEvent> newEvents = deduplicator.filterNew(fetchedEvents);
		deduplicator.trim();

		List<GitHubEvent> includedEvents = eventFilter.filterIncluded(newEvents);
		if (includedEvents.isEmpty()) {
			return;
		}

		releaseScheduler.enqueueBatch(includedEvents, windowSeconds);
		log.info("Scheduled gradual release of {} new GitHub event(s) over {}s", includedEvents.size(), windowSeconds);
	}

	private void scheduleNextPoll(int delaySeconds) {
		taskScheduler.schedule(this::poll, Instant.now().plusSeconds(delaySeconds));
	}
}
