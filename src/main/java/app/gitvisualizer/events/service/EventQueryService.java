package app.gitvisualizer.events.service;

import java.util.List;

import org.springframework.stereotype.Service;

import app.gitvisualizer.events.dto.EventsSnapshotResponse;
import app.gitvisualizer.events.dto.EventView;
import app.gitvisualizer.events.support.EventMapper;
import app.gitvisualizer.events.support.EventRingBuffer;

@Service
public class EventQueryService {

	private final EventRingBuffer ringBuffer;
	private final EventMapper eventMapper;
	private final EventIngestionService ingestionService;

	public EventQueryService(
			EventRingBuffer ringBuffer,
			EventMapper eventMapper,
			EventIngestionService ingestionService) {
		this.ringBuffer = ringBuffer;
		this.eventMapper = eventMapper;
		this.ingestionService = ingestionService;
	}

	public EventsSnapshotResponse getSnapshot(int limit) {
		int cappedLimit = Math.min(Math.max(limit, 1), 100);
		List<EventView> events = ringBuffer.snapshot(cappedLimit).stream()
				.map(eventMapper::toView)
				.toList();

		return new EventsSnapshotResponse(events, ingestionService.getLastPollAt());
	}
}
