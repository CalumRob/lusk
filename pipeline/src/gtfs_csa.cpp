#include <Rcpp.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace Rcpp;

namespace {
struct Connection {
  std::string from;
  std::string to;
  std::string trip;
  double departure;
  double arrival;
};

struct WalkEdge {
  std::string from;
  double minutes;
};

struct Rule {
  int type;
  double minimum;
};

struct Label {
  double arrival;
  double departure;
  double duration;
  int transfers;
  int walking_transfers;
  std::string trip;
};

struct Best {
  bool found = false;
  double duration = std::numeric_limits<double>::infinity();
  double departure = NA_REAL;
  double arrival = NA_REAL;
  int transfers = 0;
  int walking_transfers = 0;
};

static std::string pair_key(const std::string& from, const std::string& to) {
  return from + '\x1f' + to;
}

static std::string state_key(const std::string& stop, const std::string& trip) {
  return stop + '\x1e' + trip;
}

static bool insert_label(std::unordered_map<std::string, std::vector<std::size_t>>& labels,
                         std::unordered_map<std::string, std::vector<std::size_t>>& by_stop,
                         std::vector<Label>& all_labels,
                         std::vector<unsigned char>& active,
                         const std::string& stop, const std::string& trip,
                         const Label& value, std::size_t& inserted) {
  const std::string key = state_key(stop, trip);
  auto& state = labels[key];
  state.erase(std::remove_if(state.begin(), state.end(), [&](std::size_t id) {
    return !active[id];
  }), state.end());
  for (std::size_t id : state) {
    if (!active[id]) continue;
    const Label& old = all_labels[id];
    if (old.arrival <= value.arrival && old.duration <= value.duration &&
        (old.arrival < value.arrival || old.duration < value.duration ||
         old.transfers < value.transfers ||
         (old.transfers == value.transfers &&
          old.walking_transfers <= value.walking_transfers))) return false;
  }
  const std::size_t id = all_labels.size();
  all_labels.push_back(value);
  active.push_back(1);
  state.push_back(id);
  by_stop[stop].push_back(id);
  for (std::size_t old_id : state) {
    if (old_id == id || !active[old_id]) continue;
    const Label& old = all_labels[old_id];
    if (value.arrival <= old.arrival && value.duration <= old.duration &&
        (value.arrival < old.arrival || value.duration < old.duration ||
         value.transfers < old.transfers ||
         (value.transfers == old.transfers &&
          value.walking_transfers < old.walking_transfers))) active[old_id] = 0;
  }
  ++inserted;
  return true;
}
} // namespace

// Event scan over dated, ordered ride connections. Same-departure events are
// rescanned to a fixed point so zero-dwell connections do not depend on row order.
// Stop indexes point at active label storage by integer ID (not Label copies);
// this avoids a second large string-bearing label corpus and exact per-candidate
// scans through state maps to rediscover whether a stop index is still active.
// [[Rcpp::export]]
Rcpp::List csa_multi_target(Rcpp::DataFrame rides,
                            Rcpp::DataFrame walks,
                            Rcpp::CharacterVector origins,
                            Rcpp::List destination_sets,
                            double window_start,
                            double window_end,
                            Rcpp::DataFrame rules) {
  CharacterVector from = rides["from_stop_id"];
  CharacterVector to = rides["to_stop_id"];
  CharacterVector trip = rides["trip_id"];
  NumericVector dep = rides["departure_min"];
  NumericVector arr = rides["arrival_min"];
  const int n = rides.nrows();
  std::vector<Connection> connections;
  connections.reserve(n);
  for (int i = 0; i < n; ++i) {
    connections.push_back({as<std::string>(from[i]), as<std::string>(to[i]),
                           as<std::string>(trip[i]), dep[i], arr[i]});
  }
  std::vector<int> order(n);
  for (int i = 0; i < n; ++i) order[i] = i;
  std::stable_sort(order.begin(), order.end(), [&](int a, int b) {
    if (connections[a].departure != connections[b].departure)
      return connections[a].departure < connections[b].departure;
    return connections[a].arrival < connections[b].arrival;
  });

  CharacterVector walk_from = walks["from_stop_id"];
  CharacterVector walk_to = walks["to_stop_id"];
  NumericVector walk_min = walks["duration_min"];
  std::unordered_map<std::string, std::vector<WalkEdge>> incoming_walks;
  for (int i = 0; i < walks.nrows(); ++i) {
    incoming_walks[as<std::string>(walk_to[i])].push_back(
      {as<std::string>(walk_from[i]), walk_min[i]});
  }

  CharacterVector rule_from = rules["from_stop_id"];
  CharacterVector rule_to = rules["to_stop_id"];
  CharacterVector rule_type = rules["transfer_type"];
  NumericVector rule_seconds(rules.nrows(), 0.0);
  if (rules.containsElementNamed("min_transfer_time")) {
    CharacterVector seconds = rules["min_transfer_time"];
    for (int i = 0; i < rules.nrows(); ++i) {
      if (seconds[i] != NA_STRING && LENGTH(seconds[i]) > 0)
        rule_seconds[i] = std::stod(as<std::string>(seconds[i]));
    }
  }
  std::unordered_map<std::string, Rule> rule_map;
  for (int i = 0; i < rules.nrows(); ++i) {
    rule_map[pair_key(as<std::string>(rule_from[i]), as<std::string>(rule_to[i]))] =
      {std::stoi(as<std::string>(rule_type[i])), rule_seconds[i] / 60.0};
  }

  std::unordered_set<std::string> origin_set;
  for (auto x : origins) if (x != NA_STRING) origin_set.insert(as<std::string>(x));

  CharacterVector target_names = destination_sets.names();
  std::unordered_map<std::string, std::vector<int>> targets_by_stop;
  std::vector<std::string> target_names_cpp;
  for (int k = 0; k < destination_sets.size(); ++k) {
    std::string name = as<std::string>(target_names[k]);
    target_names_cpp.push_back(name);
    CharacterVector stops = destination_sets[k];
    for (auto x : stops) if (x != NA_STRING)
      targets_by_stop[as<std::string>(x)].push_back(k);
  }

  std::unordered_map<std::string, std::vector<std::size_t>> state_labels;
  std::unordered_map<std::string, std::vector<std::size_t>> labels_by_stop;
  std::vector<Label> all_labels;
  std::vector<unsigned char> active_labels;
  std::vector<Best> best(destination_sets.size());
  std::size_t inserted = 0;
  std::size_t transfer_checks = 0;
  std::size_t labels_examined = 0;
  std::unordered_set<std::string> origin_names = origin_set;
  for (int k = 0; k < destination_sets.size(); ++k) {
    CharacterVector d = destination_sets[k];
    for (auto x : d) if (x != NA_STRING && origin_names.count(as<std::string>(x))) {
      best[k] = {true, 0.0, NA_REAL, NA_REAL, 0};
      break;
    }
  }

  auto record = [&](const std::string& stop, const Label& label) {
    auto it = targets_by_stop.find(stop);
    if (it == targets_by_stop.end()) return;
    for (int target : it->second) {
      Best& b = best[target];
      if (!b.found || label.duration < b.duration ||
          (label.duration == b.duration && label.transfers < b.transfers)) {
        b = {true, label.duration, label.departure, label.arrival,
             label.transfers, label.walking_transfers};
      }
    }
  };

  std::size_t cursor = 0;
  while (cursor < order.size()) {
    const double event_time = connections[order[cursor]].departure;
    std::size_t end = cursor;
    while (end < order.size() && connections[order[end]].departure == event_time) ++end;
    bool can_zero_chain = false;
    for (std::size_t p = cursor; p < end; ++p)
      if (connections[order[p]].arrival == event_time) can_zero_chain = true;
    bool changed = true;
    bool first_pass = true;
    while (first_pass || (changed && can_zero_chain)) {
      first_pass = false;
      changed = false;
      for (std::size_t p = cursor; p < end; ++p) {
        const Connection& c = connections[order[p]];
        if (c.arrival < c.departure) continue;
        std::vector<std::pair<std::string, double>> candidates;
        candidates.emplace_back(c.from, 0.0);
        auto wit = incoming_walks.find(c.from);
        if (wit != incoming_walks.end()) {
          for (const auto& w : wit->second) candidates.emplace_back(w.from, w.minutes);
        }

        if (origin_set.count(c.from) && c.departure >= window_start &&
            c.departure < window_end) {
          Label first{c.arrival, c.departure, c.arrival - c.departure,
                      0, 0, c.trip};
          record(c.to, first);
          if (insert_label(state_labels, labels_by_stop, all_labels, active_labels,
                           c.to, c.trip, first, inserted))
            changed = true;
        }

        for (const auto& candidate : candidates) {
          auto lit = labels_by_stop.find(candidate.first);
          if (lit == labels_by_stop.end()) continue;
          // In a same-time zero-dwell chain, inserting a label may append to
          // this very stop's index vector. Snapshot indices to avoid iterator
          // invalidation; the next fixed-point pass observes newly inserted IDs.
          const std::vector<std::size_t> label_ids = lit->second;
          for (std::size_t label_id : label_ids) {
            ++labels_examined;
            if (!active_labels[label_id]) continue;
            const Label& previous = all_labels[label_id];
            const bool same_trip = candidate.first == c.from && previous.trip == c.trip;
            Rule rule{0, 0.0};
            auto rit = rule_map.find(pair_key(candidate.first, c.from));
            if (rit != rule_map.end()) rule = rit->second;
            if (!same_trip && rule.type == 3) continue;
            const double minimum = (!same_trip && rule.type == 2) ? rule.minimum : 0.0;
            const double ready = previous.arrival + std::max(candidate.second, minimum);
            if (ready > c.departure) continue;
            ++transfer_checks;
            Label next{c.arrival, previous.departure,
                       c.arrival - previous.departure,
                       previous.transfers + (same_trip ? 0 : 1),
                       previous.walking_transfers +
                         ((!same_trip && candidate.second > 0) ? 1 : 0),
                       c.trip};
            record(c.to, next);
            if (insert_label(state_labels, labels_by_stop, all_labels, active_labels,
                             c.to, c.trip, next, inserted))
              changed = true;
          }
        }
      }
    }
    cursor = end;
  }

  List journeys(best.size());
  journeys.attr("names") = target_names;
  for (std::size_t k = 0; k < best.size(); ++k) {
    Best b = best[k];
    journeys[k] = List::create(
      _["travel_time_min"] = b.found ? b.duration : NA_REAL,
      _["departure_min"] = b.found ? b.departure : NA_REAL,
      _["arrival_min"] = b.found ? b.arrival : NA_REAL,
      _["transfers"] = b.found ? b.transfers : NA_INTEGER,
      _["walking_transfers"] = b.found ? b.walking_transfers : NA_INTEGER);
  }
  return List::create(
    _["journeys"] = journeys,
    _["metrics"] = List::create(
      _["connections_scanned"] = static_cast<double>(connections.size()),
      _["labels_inserted"] = static_cast<double>(inserted),
      _["labels_retained"] = static_cast<double>([&]() {
        std::size_t n = 0;
         n = static_cast<std::size_t>(std::count(active_labels.begin(),
                                                 active_labels.end(), 1));
        return n;
      }()),
      _["transfer_edges"] = static_cast<double>(walks.nrows()),
      _["label_checks"] = static_cast<double>(transfer_checks),
      _["labels_examined"] = static_cast<double>(labels_examined))
  );
}
